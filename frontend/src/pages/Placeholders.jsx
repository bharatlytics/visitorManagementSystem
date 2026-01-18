import { Construction, ShieldCheck, AlertTriangle, BarChart3, FileText, Settings as SettingsIcon } from 'lucide-react'

function PlaceholderPage({ title, icon: Icon, description }) {
    return (
        <div className="flex flex-col items-center justify-center py-20">
            <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mb-4">
                {Icon ? <Icon className="w-8 h-8 text-gray-400" /> : <Construction className="w-8 h-8 text-gray-400" />}
            </div>
            <h1 className="text-xl font-bold text-gray-900 mb-2">{title}</h1>
            <p className="text-gray-500 text-sm text-center max-w-md">
                {description || 'This feature is coming soon. Stay tuned for updates!'}
            </p>
        </div>
    )
}

export function Approvals() {
    return (
        <PlaceholderPage
            title="Approvals"
            icon={ShieldCheck}
            description="Multi-level approval workflows for visitor access requests."
        />
    )
}

export function Watchlist() {
    return (
        <PlaceholderPage
            title="Watchlist"
            icon={AlertTriangle}
            description="Manage VIP, blacklisted, and restricted visitors."
        />
    )
}

export function Analytics() {
    return (
        <PlaceholderPage
            title="Analytics"
            icon={BarChart3}
            description="Advanced analytics with trend charts and insights."
        />
    )
}

export function Reports() {
    return (
        <PlaceholderPage
            title="Reports"
            icon={FileText}
            description="Generate and schedule custom reports."
        />
    )
}

export function Settings() {
    return (
        <PlaceholderPage
            title="Settings"
            icon={SettingsIcon}
            description="Configure VMS settings and preferences."
        />
    )
}
