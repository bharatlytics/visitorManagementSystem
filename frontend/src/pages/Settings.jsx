import { useState, useEffect } from 'react'
import { Settings as SettingsIcon, Building, Bell, Shield, Clock, Save, Check } from 'lucide-react'
import api from '../api/client'

function SettingCard({ title, description, children }) {
    return (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="font-semibold text-gray-900 text-sm">{title}</h3>
            {description && <p className="text-xs text-gray-500 mt-1 mb-4">{description}</p>}
            <div className="mt-4">{children}</div>
        </div>
    )
}

function Toggle({ checked, onChange, label }) {
    return (
        <label className="flex items-center justify-between cursor-pointer">
            <span className="text-sm text-gray-700">{label}</span>
            <button type="button" onClick={() => onChange(!checked)}
                className={`relative w-10 h-5 rounded-full transition-colors ${checked ? 'bg-blue-600' : 'bg-gray-200'}`}>
                <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : ''}`}></span>
            </button>
        </label>
    )
}

export default function Settings() {
    const [settings, setSettings] = useState({
        autoCheckout: true,
        autoCheckoutHours: 8,
        requireApproval: false,
        notifyHost: true,
        notifyOnCheckIn: true,
        notifyOnCheckOut: true,
        badgeExpiry: 24,
        requireIdVerification: false,
        enableWatchlistCheck: true,
        enableFaceRecognition: true
    })
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [saved, setSaved] = useState(false)

    useEffect(() => {
        fetchSettings()
    }, [])

    const fetchSettings = async () => {
        try {
            setLoading(true)
            const response = await api.get('/settings')
            if (response.data) {
                setSettings(prev => ({ ...prev, ...response.data }))
            }
        } catch (err) {
            console.error('Failed to load settings:', err)
        } finally {
            setLoading(false)
        }
    }

    const handleSave = async () => {
        setSaving(true)
        try {
            await api.put('/settings', settings)
            setSaved(true)
            setTimeout(() => setSaved(false), 2000)
        } catch (err) {
            alert(err.response?.data?.error || 'Failed to save settings')
        } finally {
            setSaving(false)
        }
    }

    const updateSetting = (key, value) => {
        setSettings(prev => ({ ...prev, [key]: value }))
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-200 border-t-blue-600"></div>
            </div>
        )
    }

    return (
        <div className="space-y-5 max-w-3xl">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-bold text-gray-900">Settings</h1>
                    <p className="text-sm text-gray-500">Configure VMS preferences</p>
                </div>
                <button onClick={handleSave} disabled={saving}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${saved ? 'bg-green-600 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'
                        } disabled:opacity-50`}>
                    {saving ? <Clock className="w-4 h-4 animate-spin" /> : saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
                    {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Changes'}
                </button>
            </div>

            {/* Visit Settings */}
            <SettingCard title="Visit Settings" description="Configure visit handling behavior">
                <div className="space-y-4">
                    <Toggle
                        label="Auto checkout after hours"
                        checked={settings.autoCheckout}
                        onChange={(v) => updateSetting('autoCheckout', v)}
                    />
                    {settings.autoCheckout && (
                        <div className="flex items-center gap-3 pl-4">
                            <label className="text-sm text-gray-600">Auto checkout after</label>
                            <input type="number" value={settings.autoCheckoutHours}
                                onChange={(e) => updateSetting('autoCheckoutHours', parseInt(e.target.value))}
                                className="w-16 px-2 py-1 border border-gray-300 rounded-lg text-sm text-center" min={1} max={24} />
                            <span className="text-sm text-gray-600">hours</span>
                        </div>
                    )}
                    <Toggle
                        label="Require approval for all visits"
                        checked={settings.requireApproval}
                        onChange={(v) => updateSetting('requireApproval', v)}
                    />
                    <div className="flex items-center gap-3">
                        <label className="text-sm text-gray-600">Badge expiry</label>
                        <input type="number" value={settings.badgeExpiry}
                            onChange={(e) => updateSetting('badgeExpiry', parseInt(e.target.value))}
                            className="w-16 px-2 py-1 border border-gray-300 rounded-lg text-sm text-center" min={1} max={72} />
                        <span className="text-sm text-gray-600">hours</span>
                    </div>
                </div>
            </SettingCard>

            {/* Notifications */}
            <SettingCard title="Notifications" description="Host notification preferences">
                <div className="space-y-4">
                    <Toggle
                        label="Notify host on visitor arrival"
                        checked={settings.notifyHost}
                        onChange={(v) => updateSetting('notifyHost', v)}
                    />
                    <Toggle
                        label="Send check-in notifications"
                        checked={settings.notifyOnCheckIn}
                        onChange={(v) => updateSetting('notifyOnCheckIn', v)}
                    />
                    <Toggle
                        label="Send check-out notifications"
                        checked={settings.notifyOnCheckOut}
                        onChange={(v) => updateSetting('notifyOnCheckOut', v)}
                    />
                </div>
            </SettingCard>

            {/* Security */}
            <SettingCard title="Security" description="Security and verification settings">
                <div className="space-y-4">
                    <Toggle
                        label="Require ID verification"
                        checked={settings.requireIdVerification}
                        onChange={(v) => updateSetting('requireIdVerification', v)}
                    />
                    <Toggle
                        label="Enable watchlist check"
                        checked={settings.enableWatchlistCheck}
                        onChange={(v) => updateSetting('enableWatchlistCheck', v)}
                    />
                    <Toggle
                        label="Enable face recognition"
                        checked={settings.enableFaceRecognition}
                        onChange={(v) => updateSetting('enableFaceRecognition', v)}
                    />
                </div>
            </SettingCard>
        </div>
    )
}
