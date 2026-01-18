import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
    LayoutDashboard, Users, Calendar, ShieldCheck, AlertTriangle,
    BarChart3, FileText, Settings, Menu, LogOut, Bell, Search, Monitor
} from 'lucide-react'
import { useAuthStore } from '../../store/authStore'

const navigation = [
    { name: 'Dashboard', href: '/', icon: LayoutDashboard },
    { name: 'Visitors', href: '/visitors', icon: Users },
    { name: 'Visits', href: '/visits', icon: Calendar },
    { name: 'Approvals', href: '/approvals', icon: ShieldCheck },
    { name: 'Watchlist', href: '/watchlist', icon: AlertTriangle },
    { name: 'Analytics', href: '/analytics', icon: BarChart3 },
    { name: 'Reports', href: '/reports', icon: FileText },
    { name: 'Devices', href: '/devices', icon: Monitor },
    { name: 'Settings', href: '/settings', icon: Settings },
]

export default function Layout({ children }) {
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
    const [mobileOpen, setMobileOpen] = useState(false)
    const location = useLocation()
    const { user, logout, isPlatformConnected, company } = useAuthStore()

    return (
        <div className="min-h-screen bg-gray-50 flex">
            {/* Mobile backdrop */}
            {mobileOpen && (
                <div
                    className="fixed inset-0 z-40 bg-black/20 lg:hidden"
                    onClick={() => setMobileOpen(false)}
                />
            )}

            {/* Sidebar */}
            <aside className={`
                fixed lg:static inset-y-0 left-0 z-50 
                ${sidebarCollapsed ? 'w-16' : 'w-56'} 
                ${mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
                bg-white border-r border-gray-200 flex flex-col transition-all duration-200
            `}>
                {/* Logo */}
                <div className={`h-14 flex items-center border-b border-gray-100 ${sidebarCollapsed ? 'justify-center px-2' : 'px-4'}`}>
                    <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-blue-700 rounded-lg flex items-center justify-center shadow-sm">
                        <Users className="w-4 h-4 text-white" />
                    </div>
                    {!sidebarCollapsed && (
                        <span className="ml-2.5 font-semibold text-gray-900 text-sm">VMS Enterprise</span>
                    )}
                </div>

                {/* Navigation */}
                <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
                    {navigation.map((item) => {
                        const isActive = location.pathname === item.href
                        return (
                            <Link
                                key={item.name}
                                to={item.href}
                                title={sidebarCollapsed ? item.name : undefined}
                                className={`
                                    flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] font-medium transition-colors
                                    ${isActive ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'}
                                    ${sidebarCollapsed ? 'justify-center' : ''}
                                `}
                                onClick={() => setMobileOpen(false)}
                            >
                                <item.icon className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-blue-600' : ''}`} />
                                {!sidebarCollapsed && item.name}
                            </Link>
                        )
                    })}
                </nav>

                {/* User section */}
                <div className={`p-2 border-t border-gray-100 ${sidebarCollapsed ? 'flex justify-center' : ''}`}>
                    <button
                        onClick={logout}
                        title={isPlatformConnected ? "Exit to Platform" : "Sign out"}
                        className={`
                            flex items-center gap-2 text-[13px] text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors
                            ${sidebarCollapsed ? 'p-2' : 'w-full px-2.5 py-2'}
                        `}
                    >
                        <LogOut className="w-4 h-4" />
                        {!sidebarCollapsed && (isPlatformConnected ? 'Exit App' : 'Sign out')}
                    </button>
                </div>
            </aside>

            {/* Main */}
            <div className="flex-1 flex flex-col min-w-0">
                {/* Header */}
                <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-4 sticky top-0 z-30">
                    <div className="flex items-center gap-3">
                        <button
                            className="lg:hidden p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
                            onClick={() => setMobileOpen(true)}
                        >
                            <Menu className="w-5 h-5" />
                        </button>
                        <button
                            className="hidden lg:flex p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
                            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                        >
                            <Menu className="w-4 h-4" />
                        </button>

                        {/* Search */}
                        <div className="hidden md:flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 w-64">
                            <Search className="w-4 h-4 text-gray-400" />
                            <input
                                type="text"
                                placeholder="Search..."
                                className="bg-transparent border-none outline-none text-sm text-gray-700 placeholder-gray-400 w-full"
                            />
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        {/* Platform connection badge */}
                        {isPlatformConnected && (
                            <span className="hidden sm:flex items-center gap-1.5 px-2 py-1 bg-green-50 text-green-700 text-xs font-medium rounded-full">
                                <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span>
                                Connected
                            </span>
                        )}

                        <button className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg relative">
                            <Bell className="w-4 h-4" />
                            <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full"></span>
                        </button>

                        {/* Company logo and name */}
                        <div className="flex items-center gap-2 pl-2 border-l border-gray-200 ml-1">
                            {company?.logo ? (
                                <img
                                    src={company.logo}
                                    alt={company?.name}
                                    className="h-7 max-w-[100px] object-contain"
                                />
                            ) : (
                                <div className="w-7 h-7 bg-blue-100 rounded-lg flex items-center justify-center">
                                    <span className="text-blue-700 text-xs font-semibold">
                                        {company?.name?.charAt(0) || user?.name?.charAt(0) || 'U'}
                                    </span>
                                </div>
                            )}
                            <span className="hidden sm:block text-sm font-medium text-gray-700">
                                {company?.name || user?.name || 'User'}
                            </span>
                        </div>
                    </div>
                </header>

                {/* Page */}
                <main className="flex-1 p-4 lg:p-5 overflow-auto">
                    {children}
                </main>
            </div>
        </div>
    )
}
