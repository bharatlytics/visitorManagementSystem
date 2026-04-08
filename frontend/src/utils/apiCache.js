/**
 * API Cache Layer — In-Memory with TTL
 * 
 * Eliminates redundant API calls when navigating between pages.
 * Provides SWR (stale-while-revalidate) pattern for instant page loads.
 * 
 * Usage:
 *   import { cachedGet, invalidate, useStaleData } from '../utils/apiCache'
 *   
 *   // Simple cached GET (returns promise)
 *   const res = await cachedGet(api, '/dashboard/stats', 60000)
 *   
 *   // SWR hook (shows cached data instantly, refreshes in background)
 *   const { data, loading, isStale } = useStaleData(api, '/dashboard/stats', 60000)
 *   
 *   // Invalidate after write operations
 *   await api.post('/visitors', newVisitor)
 *   invalidate('/visitors')
 */
import { useState, useEffect, useRef } from 'react'

// In-memory cache store
const cache = new Map()

/**
 * Cached GET request with TTL
 * @param {object} api - Axios instance
 * @param {string} url - API endpoint
 * @param {number} ttlMs - Cache TTL in milliseconds (default 30s)
 * @returns {Promise} - Axios response (with .cached flag if from cache)
 */
export function cachedGet(api, url, ttlMs = 30000) {
    const entry = cache.get(url)
    if (entry && Date.now() - entry.ts < ttlMs) {
        return Promise.resolve({ data: entry.data, cached: true })
    }
    return api.get(url).then(res => {
        cache.set(url, { data: res.data, ts: Date.now() })
        return res
    })
}

/**
 * Invalidate cache entries matching a URL pattern
 * Call after POST/PUT/DELETE operations
 * @param {string} pattern - Substring to match against cached URLs
 */
export function invalidate(pattern) {
    for (const key of cache.keys()) {
        if (key.includes(pattern)) cache.delete(key)
    }
}

/**
 * Clear entire cache (e.g. on logout)
 */
export function clearCache() {
    cache.clear()
}

/**
 * SWR Hook — Stale-While-Revalidate
 * Shows cached data immediately, fetches fresh data in background.
 * 
 * @param {object} api - Axios instance
 * @param {string} url - API endpoint (null to skip)
 * @param {number} ttlMs - Cache TTL in milliseconds
 * @returns {{ data: any, loading: boolean, isStale: boolean, refetch: function }}
 */
export function useStaleData(api, url, ttlMs = 60000) {
    const cached = url ? cache.get(url) : null
    const [data, setData] = useState(cached?.data ?? null)
    const [loading, setLoading] = useState(!cached)
    const [isStale, setIsStale] = useState(!!cached)
    const urlRef = useRef(url)

    useEffect(() => {
        urlRef.current = url
        if (!url) return

        // Show cached data immediately
        const entry = cache.get(url)
        if (entry) {
            setData(entry.data)
            setLoading(false)
            setIsStale(true)
            // If cache is still fresh, don't refetch
            if (Date.now() - entry.ts < ttlMs) return
        }

        // Fetch fresh data
        api.get(url)
            .then(res => {
                if (urlRef.current !== url) return // stale request
                cache.set(url, { data: res.data, ts: Date.now() })
                setData(res.data)
                setIsStale(false)
                setLoading(false)
            })
            .catch(() => {
                // On error, keep showing stale data if available
                if (!data) setLoading(false)
            })
    }, [url]) // eslint-disable-line react-hooks/exhaustive-deps

    const refetch = () => {
        if (!url) return
        invalidate(url)
        setLoading(true)
        api.get(url)
            .then(res => {
                cache.set(url, { data: res.data, ts: Date.now() })
                setData(res.data)
                setIsStale(false)
                setLoading(false)
            })
            .catch(() => setLoading(false))
    }

    return { data, loading, isStale, refetch }
}
