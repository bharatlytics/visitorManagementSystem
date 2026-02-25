import { useState, useEffect } from 'react'
import {
    Settings as SettingsIcon, Building, Bell, Shield, Clock, Save, Check, Mail,
    Smartphone, MessageSquare, Globe, Webhook, Key, Eye, EyeOff, MonitorSpeaker,
    Palette, FileText, Database, ChevronRight, AlertTriangle, Zap, Send, ExternalLink
} from 'lucide-react'
import api from '../api/client'

// ─── Reusable Components ──────────────────────────────────────────

function SettingCard({ title, description, children, icon: Icon }) {
    return (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-start gap-3 mb-4">
                {Icon && <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center flex-shrink-0"><Icon className="w-4 h-4 text-blue-600" /></div>}
                <div>
                    <h3 className="font-semibold text-gray-900 text-sm">{title}</h3>
                    {description && <p className="text-xs text-gray-500 mt-0.5">{description}</p>}
                </div>
            </div>
            <div>{children}</div>
        </div>
    )
}

function Toggle({ checked, onChange, label, description }) {
    return (
        <label className="flex items-center justify-between cursor-pointer py-1">
            <div>
                <span className="text-sm text-gray-700">{label}</span>
                {description && <p className="text-xs text-gray-400 mt-0.5">{description}</p>}
            </div>
            <button type="button" onClick={() => onChange(!checked)}
                className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ml-4 ${checked ? 'bg-blue-600' : 'bg-gray-200'}`}>
                <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : ''}`}></span>
            </button>
        </label>
    )
}

function InputField({ label, value, onChange, type = 'text', placeholder, description, ...props }) {
    return (
        <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
            <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                {...props} />
            {description && <p className="text-xs text-gray-400 mt-1">{description}</p>}
        </div>
    )
}

function PasswordField({ label, value, onChange, placeholder }) {
    const [show, setShow] = useState(false)
    return (
        <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
            <div className="relative">
                <input type={show ? 'text' : 'password'} value={value} onChange={e => onChange(e.target.value)}
                    placeholder={placeholder}
                    className="w-full px-3 py-2 pr-10 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                <button type="button" onClick={() => setShow(s => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
            </div>
        </div>
    )
}

function StatusBadge({ active }) {
    return (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-green-500' : 'bg-gray-400'}`}></span>
            {active ? 'Active' : 'Inactive'}
        </span>
    )
}

// ─── Tab Navigation ───────────────────────────────────────────────

const TABS = [
    { id: 'general', label: 'General', icon: Building },
    { id: 'visitor', label: 'Visitor', icon: FileText },
    { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'integrations', label: 'Integrations', icon: Zap },
    { id: 'security', label: 'Security', icon: Shield },
    { id: 'kiosk', label: 'Kiosk & Device', icon: MonitorSpeaker },
    { id: 'email', label: 'Email (SMTP)', icon: Mail },
    { id: 'compliance', label: 'Compliance', icon: Database },
]

// ─── Main Component ───────────────────────────────────────────────

export default function Settings() {
    const [activeTab, setActiveTab] = useState('general')
    const [settings, setSettings] = useState({
        general: { companyName: '', timezone: 'Asia/Kolkata', dateFormat: 'DD/MM/YYYY', timeFormat: '12h', language: 'en' },
        visitor: {
            requirePhoto: true, requireIdVerification: false,
            autoCheckout: true, autoCheckoutHours: 8,
            preRegistrationEnabled: true, groupVisitsEnabled: true,
            requireApproval: false, badgeExpiry: 24,
            visitorTypes: 'general,contractor,interview,vendor,delivery',
            idTypes: 'aadhar,passport,drivers_license,employee_id',
        },
        notifications: {
            hostNotifyOnArrival: true, notifyOnCheckIn: true, notifyOnCheckOut: true,
            emailNotifications: true, smsNotifications: false, whatsappNotifications: false, pushNotifications: true,
        },
        integrations: {
            whatsappEnabled: false, whatsappPhoneId: '', whatsappApiKey: '', whatsappBusinessAccountId: '',
            smsEnabled: false, smsProvider: 'twilio', smsApiKey: '', smsSenderId: '',
            webhookEnabled: false, webhookUrl: '', webhookSecret: '',
            webhookEvents: 'check_in,check_out,visitor_registered',
        },
        security: {
            requireIdVerification: false, enableWatchlistCheck: true, enableFaceRecognition: true,
            require2FA: false, sessionTimeoutMinutes: 30, ipWhitelist: '',
            blacklistAutoReject: true, requireApprovalForVIP: false,
        },
        kiosk: {
            welcomeMessage: 'Welcome! Please check in.',
            primaryColor: '#1976d2', logoUrl: '',
            autoLogoutMinutes: 2,
            allowedVisitTypes: 'general,contractor,interview',
            requirePhotoOnKiosk: true, showHostDirectory: true, enableSelfCheckIn: true,
        },
        smtp: { host: '', port: 587, secure: false, user: '', password: '', fromEmail: '' },
        compliance: {
            gdprEnabled: false,
            gdprConsentText: 'By checking in, you agree to our privacy policy and data handling practices.',
            dataRetentionDays: 365, autoAnonymize: false, auditLogging: true, exportDataFormat: 'csv',
        },
    })
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [saved, setSaved] = useState(false)
    const [testingEmail, setTestingEmail] = useState(false)

    useEffect(() => { fetchSettings() }, [])

    const fetchSettings = async () => {
        try {
            setLoading(true)
            const response = await api.get('/settings')
            if (response.data?.settings) {
                setSettings(prev => {
                    const merged = { ...prev }
                    for (const key of Object.keys(prev)) {
                        if (response.data.settings[key]) {
                            merged[key] = { ...prev[key], ...response.data.settings[key] }
                        }
                    }
                    return merged
                })
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

    const u = (category, key, value) => {
        setSettings(prev => ({ ...prev, [category]: { ...prev[category], [key]: value } }))
    }

    const handleTestEmail = async () => {
        const testEmail = prompt('Enter email address to send test email to:')
        if (!testEmail) return
        setTestingEmail(true)
        try {
            await api.post('/settings/test-email', { companyId: localStorage.getItem('vms_company_id'), toEmail: testEmail })
            alert('Test email sent successfully! Check your inbox.')
        } catch (err) {
            alert(err.response?.data?.error || 'Failed to send test email.')
        } finally {
            setTestingEmail(false)
        }
    }

    const handleTestWebhook = async () => {
        try {
            await fetch(settings.integrations.webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ event: 'test', timestamp: new Date().toISOString(), message: 'VMS webhook test' })
            })
            alert('Test webhook sent!')
        } catch (err) {
            alert('Webhook test failed: ' + err.message)
        }
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-200 border-t-blue-600"></div>
            </div>
        )
    }

    // ─── Tab Content ──────────────────────────────────────────────

    const renderGeneralTab = () => (
        <div className="space-y-5">
            <SettingCard title="Organization" description="Company identity and branding" icon={Building}>
                <div className="space-y-4">
                    <InputField label="Company Name" value={settings.general.companyName}
                        onChange={v => u('general', 'companyName', v)} placeholder="Acme Corporation" />
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Timezone</label>
                            <select value={settings.general.timezone} onChange={e => u('general', 'timezone', e.target.value)}
                                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                                <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
                                <option value="UTC">UTC</option>
                                <option value="America/New_York">America/New York (EST)</option>
                                <option value="Europe/London">Europe/London (GMT)</option>
                                <option value="Asia/Dubai">Asia/Dubai (GST)</option>
                                <option value="Asia/Singapore">Asia/Singapore (SGT)</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Date Format</label>
                            <select value={settings.general.dateFormat} onChange={e => u('general', 'dateFormat', e.target.value)}
                                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                                <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                                <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                                <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                            </select>
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Time Format</label>
                            <select value={settings.general.timeFormat} onChange={e => u('general', 'timeFormat', e.target.value)}
                                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                                <option value="12h">12-hour</option>
                                <option value="24h">24-hour</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Language</label>
                            <select value={settings.general.language} onChange={e => u('general', 'language', e.target.value)}
                                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                                <option value="en">English</option>
                                <option value="hi">Hindi</option>
                                <option value="de">German</option>
                                <option value="fr">French</option>
                            </select>
                        </div>
                    </div>
                </div>
            </SettingCard>
        </div>
    )

    const renderVisitorTab = () => (
        <div className="space-y-5">
            <SettingCard title="Visit Handling" description="Configure how visits are processed" icon={FileText}>
                <div className="space-y-4">
                    <Toggle label="Auto checkout after hours" checked={settings.visitor.autoCheckout}
                        onChange={v => u('visitor', 'autoCheckout', v)} />
                    {settings.visitor.autoCheckout && (
                        <div className="flex items-center gap-3 pl-4">
                            <label className="text-sm text-gray-600">Auto checkout after</label>
                            <input type="number" value={settings.visitor.autoCheckoutHours}
                                onChange={e => u('visitor', 'autoCheckoutHours', parseInt(e.target.value))}
                                className="w-16 px-2 py-1 border border-gray-200 rounded-lg text-sm text-center" min={1} max={24} />
                            <span className="text-sm text-gray-600">hours</span>
                        </div>
                    )}
                    <Toggle label="Require approval for all visits" checked={settings.visitor.requireApproval}
                        onChange={v => u('visitor', 'requireApproval', v)} />
                    <Toggle label="Enable pre-registration" checked={settings.visitor.preRegistrationEnabled}
                        onChange={v => u('visitor', 'preRegistrationEnabled', v)}
                        description="Allow hosts to pre-register visitors before arrival" />
                    <Toggle label="Enable group visits" checked={settings.visitor.groupVisitsEnabled}
                        onChange={v => u('visitor', 'groupVisitsEnabled', v)} />
                    <div className="flex items-center gap-3">
                        <label className="text-sm text-gray-600">Badge expiry</label>
                        <input type="number" value={settings.visitor.badgeExpiry}
                            onChange={e => u('visitor', 'badgeExpiry', parseInt(e.target.value))}
                            className="w-16 px-2 py-1 border border-gray-200 rounded-lg text-sm text-center" min={1} max={72} />
                        <span className="text-sm text-gray-600">hours</span>
                    </div>
                </div>
            </SettingCard>
            <SettingCard title="Visitor Configuration" description="Types and ID requirements" icon={FileText}>
                <div className="space-y-4">
                    <Toggle label="Require photo during registration" checked={settings.visitor.requirePhoto}
                        onChange={v => u('visitor', 'requirePhoto', v)} />
                    <Toggle label="Require ID verification" checked={settings.visitor.requireIdVerification}
                        onChange={v => u('visitor', 'requireIdVerification', v)} />
                    <InputField label="Visitor Types" value={settings.visitor.visitorTypes}
                        onChange={v => u('visitor', 'visitorTypes', v)}
                        description="Comma-separated list of visitor types" placeholder="general,contractor,interview" />
                    <InputField label="ID Types" value={settings.visitor.idTypes}
                        onChange={v => u('visitor', 'idTypes', v)}
                        description="Comma-separated list of accepted ID types" placeholder="aadhar,passport,drivers_license" />
                </div>
            </SettingCard>
        </div>
    )

    const renderNotificationsTab = () => (
        <div className="space-y-5">
            <SettingCard title="Notification Events" description="When to send notifications" icon={Bell}>
                <div className="space-y-3">
                    <Toggle label="Notify host on visitor arrival" checked={settings.notifications.hostNotifyOnArrival}
                        onChange={v => u('notifications', 'hostNotifyOnArrival', v)} />
                    <Toggle label="Send check-in notifications" checked={settings.notifications.notifyOnCheckIn}
                        onChange={v => u('notifications', 'notifyOnCheckIn', v)} />
                    <Toggle label="Send check-out notifications" checked={settings.notifications.notifyOnCheckOut}
                        onChange={v => u('notifications', 'notifyOnCheckOut', v)} />
                </div>
            </SettingCard>
            <SettingCard title="Notification Channels" description="How to deliver notifications" icon={Smartphone}>
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2"><Mail className="w-4 h-4 text-gray-500" /><span className="text-sm text-gray-700">Email</span></div>
                        <StatusBadge active={settings.notifications.emailNotifications} />
                    </div>
                    <Toggle label="Email notifications" checked={settings.notifications.emailNotifications}
                        onChange={v => u('notifications', 'emailNotifications', v)} description="Requires SMTP configuration in Email tab" />
                    <Toggle label="SMS notifications" checked={settings.notifications.smsNotifications}
                        onChange={v => u('notifications', 'smsNotifications', v)} description="Requires SMS integration setup" />
                    <Toggle label="WhatsApp notifications" checked={settings.notifications.whatsappNotifications}
                        onChange={v => u('notifications', 'whatsappNotifications', v)} description="Requires WhatsApp Business API setup" />
                    <Toggle label="Push notifications" checked={settings.notifications.pushNotifications}
                        onChange={v => u('notifications', 'pushNotifications', v)} />
                </div>
            </SettingCard>
        </div>
    )

    const renderIntegrationsTab = () => (
        <div className="space-y-5">
            <SettingCard title="WhatsApp Business API" description="Send visitor notifications via WhatsApp" icon={MessageSquare}>
                <div className="space-y-4">
                    <div className="flex items-center justify-between mb-2">
                        <Toggle label="Enable WhatsApp Integration" checked={settings.integrations.whatsappEnabled}
                            onChange={v => u('integrations', 'whatsappEnabled', v)} />
                        <StatusBadge active={settings.integrations.whatsappEnabled} />
                    </div>
                    {settings.integrations.whatsappEnabled && (
                        <div className="space-y-3 pl-1 border-l-2 border-green-200 ml-1 pl-4">
                            <InputField label="WhatsApp Phone Number ID" value={settings.integrations.whatsappPhoneId}
                                onChange={v => u('integrations', 'whatsappPhoneId', v)} placeholder="1234567890" />
                            <PasswordField label="API Key / Access Token" value={settings.integrations.whatsappApiKey}
                                onChange={v => u('integrations', 'whatsappApiKey', v)} placeholder="EAAx..." />
                            <InputField label="Business Account ID" value={settings.integrations.whatsappBusinessAccountId}
                                onChange={v => u('integrations', 'whatsappBusinessAccountId', v)} placeholder="WABA ID" />
                        </div>
                    )}
                </div>
            </SettingCard>

            <SettingCard title="SMS Gateway" description="Send visitor notifications via SMS" icon={Smartphone}>
                <div className="space-y-4">
                    <div className="flex items-center justify-between mb-2">
                        <Toggle label="Enable SMS Integration" checked={settings.integrations.smsEnabled}
                            onChange={v => u('integrations', 'smsEnabled', v)} />
                        <StatusBadge active={settings.integrations.smsEnabled} />
                    </div>
                    {settings.integrations.smsEnabled && (
                        <div className="space-y-3 pl-1 border-l-2 border-blue-200 ml-1 pl-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">SMS Provider</label>
                                <select value={settings.integrations.smsProvider} onChange={e => u('integrations', 'smsProvider', e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                                    <option value="twilio">Twilio</option>
                                    <option value="msg91">MSG91</option>
                                    <option value="textlocal">Textlocal</option>
                                    <option value="nexmo">Vonage (Nexmo)</option>
                                    <option value="custom">Custom API</option>
                                </select>
                            </div>
                            <PasswordField label="API Key / Auth Token" value={settings.integrations.smsApiKey}
                                onChange={v => u('integrations', 'smsApiKey', v)} placeholder="API key" />
                            <InputField label="Sender ID" value={settings.integrations.smsSenderId}
                                onChange={v => u('integrations', 'smsSenderId', v)} placeholder="VMSMGR"
                                description="6-character sender ID for SMS header" />
                        </div>
                    )}
                </div>
            </SettingCard>

            <SettingCard title="Webhooks" description="Send real-time event data to external systems" icon={Globe}>
                <div className="space-y-4">
                    <div className="flex items-center justify-between mb-2">
                        <Toggle label="Enable Webhooks" checked={settings.integrations.webhookEnabled}
                            onChange={v => u('integrations', 'webhookEnabled', v)} />
                        <StatusBadge active={settings.integrations.webhookEnabled} />
                    </div>
                    {settings.integrations.webhookEnabled && (
                        <div className="space-y-3 pl-1 border-l-2 border-purple-200 ml-1 pl-4">
                            <InputField label="Webhook URL" value={settings.integrations.webhookUrl}
                                onChange={v => u('integrations', 'webhookUrl', v)} placeholder="https://your-api.com/webhook" />
                            <PasswordField label="Webhook Secret" value={settings.integrations.webhookSecret}
                                onChange={v => u('integrations', 'webhookSecret', v)} placeholder="whsec_..." />
                            <InputField label="Events" value={settings.integrations.webhookEvents}
                                onChange={v => u('integrations', 'webhookEvents', v)}
                                description="Comma-separated events: check_in, check_out, visitor_registered, visitor_deleted, alert_triggered"
                                placeholder="check_in,check_out,visitor_registered" />
                            <button onClick={handleTestWebhook} disabled={!settings.integrations.webhookUrl}
                                className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-purple-700 bg-purple-50 rounded-lg hover:bg-purple-100 disabled:opacity-50">
                                <Send className="w-3 h-3" /> Send Test Webhook
                            </button>
                        </div>
                    )}
                </div>
            </SettingCard>
        </div>
    )

    const renderSecurityTab = () => (
        <div className="space-y-5">
            <SettingCard title="Verification" description="Identity and security checks" icon={Shield}>
                <div className="space-y-3">
                    <Toggle label="Require ID verification" checked={settings.security.requireIdVerification}
                        onChange={v => u('security', 'requireIdVerification', v)}
                        description="Visitors must present a valid ID during check-in" />
                    <Toggle label="Enable watchlist check" checked={settings.security.enableWatchlistCheck}
                        onChange={v => u('security', 'enableWatchlistCheck', v)}
                        description="Automatically check visitors against blacklist/watchlist" />
                    <Toggle label="Enable face recognition" checked={settings.security.enableFaceRecognition}
                        onChange={v => u('security', 'enableFaceRecognition', v)}
                        description="Use facial recognition for visitor identification" />
                    <Toggle label="Auto-reject blacklisted visitors" checked={settings.security.blacklistAutoReject}
                        onChange={v => u('security', 'blacklistAutoReject', v)} />
                    <Toggle label="Require approval for VIP visitors" checked={settings.security.requireApprovalForVIP}
                        onChange={v => u('security', 'requireApprovalForVIP', v)} />
                </div>
            </SettingCard>
            <SettingCard title="Access Control" description="Session and access management" icon={Key}>
                <div className="space-y-4">
                    <Toggle label="Require two-factor authentication" checked={settings.security.require2FA}
                        onChange={v => u('security', 'require2FA', v)} description="For admin login" />
                    <div className="flex items-center gap-3">
                        <label className="text-sm text-gray-600">Session timeout</label>
                        <input type="number" value={settings.security.sessionTimeoutMinutes}
                            onChange={e => u('security', 'sessionTimeoutMinutes', parseInt(e.target.value))}
                            className="w-20 px-2 py-1 border border-gray-200 rounded-lg text-sm text-center" min={5} max={480} />
                        <span className="text-sm text-gray-600">minutes</span>
                    </div>
                    <InputField label="IP Whitelist" value={settings.security.ipWhitelist}
                        onChange={v => u('security', 'ipWhitelist', v)}
                        description="Comma-separated IPs allowed to access admin panel. Leave empty to allow all."
                        placeholder="192.168.1.0/24, 10.0.0.0/8" />
                </div>
            </SettingCard>
        </div>
    )

    const renderKioskTab = () => (
        <div className="space-y-5">
            <SettingCard title="Kiosk Branding" description="Customize the kiosk check-in experience" icon={Palette}>
                <div className="space-y-4">
                    <InputField label="Welcome Message" value={settings.kiosk.welcomeMessage}
                        onChange={v => u('kiosk', 'welcomeMessage', v)} placeholder="Welcome! Please check in." />
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Primary Color</label>
                            <div className="flex items-center gap-2">
                                <input type="color" value={settings.kiosk.primaryColor}
                                    onChange={e => u('kiosk', 'primaryColor', e.target.value)}
                                    className="w-10 h-10 rounded-lg border border-gray-200 cursor-pointer" />
                                <input type="text" value={settings.kiosk.primaryColor}
                                    onChange={e => u('kiosk', 'primaryColor', e.target.value)}
                                    className="w-28 px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono" />
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            <label className="text-sm text-gray-600">Auto-logout after</label>
                            <input type="number" value={settings.kiosk.autoLogoutMinutes}
                                onChange={e => u('kiosk', 'autoLogoutMinutes', parseInt(e.target.value))}
                                className="w-16 px-2 py-1 border border-gray-200 rounded-lg text-sm text-center" min={1} max={30} />
                            <span className="text-sm text-gray-600">min</span>
                        </div>
                    </div>
                    <InputField label="Logo URL" value={settings.kiosk.logoUrl}
                        onChange={v => u('kiosk', 'logoUrl', v)} placeholder="https://example.com/logo.png" />
                </div>
            </SettingCard>
            <SettingCard title="Kiosk Features" description="What the kiosk can do" icon={MonitorSpeaker}>
                <div className="space-y-3">
                    <Toggle label="Enable self check-in" checked={settings.kiosk.enableSelfCheckIn}
                        onChange={v => u('kiosk', 'enableSelfCheckIn', v)}
                        description="Visitors can check themselves in at the kiosk" />
                    <Toggle label="Require photo on kiosk" checked={settings.kiosk.requirePhotoOnKiosk}
                        onChange={v => u('kiosk', 'requirePhotoOnKiosk', v)}
                        description="Take visitor photo during kiosk check-in" />
                    <Toggle label="Show host directory" checked={settings.kiosk.showHostDirectory}
                        onChange={v => u('kiosk', 'showHostDirectory', v)}
                        description="Allow visitors to search and select their host at the kiosk" />
                    <InputField label="Allowed Visit Types" value={settings.kiosk.allowedVisitTypes}
                        onChange={v => u('kiosk', 'allowedVisitTypes', v)}
                        description="Comma-separated visit types shown on kiosk" placeholder="general,contractor,interview" />
                </div>
            </SettingCard>
        </div>
    )

    const renderEmailTab = () => (
        <div className="space-y-5">
            <SettingCard title="SMTP Configuration" description="Email server for sending approval and notification emails" icon={Mail}>
                <div className="space-y-4">
                    <InputField label="SMTP Server Host" value={settings.smtp.host} onChange={v => u('smtp', 'host', v)} placeholder="smtp.gmail.com" />
                    <div className="grid grid-cols-2 gap-4">
                        <InputField label="Port" type="number" value={settings.smtp.port} onChange={v => u('smtp', 'port', parseInt(v))} />
                        <div className="flex items-end pb-1">
                            <Toggle label="Secure Connection (TLS/SSL)" checked={settings.smtp.secure} onChange={v => u('smtp', 'secure', v)} />
                        </div>
                    </div>
                    <InputField label="Username" value={settings.smtp.user} onChange={v => u('smtp', 'user', v)} placeholder="your-email@example.com" />
                    <PasswordField label="Password" value={settings.smtp.password} onChange={v => u('smtp', 'password', v)} placeholder="••••••••" />
                    <InputField label="From Email Address" value={settings.smtp.fromEmail} onChange={v => u('smtp', 'fromEmail', v)}
                        type="email" placeholder="noreply@yourcompany.com" />
                    <div className="pt-2 border-t border-gray-100">
                        <button onClick={handleTestEmail} disabled={testingEmail || !settings.smtp.host}
                            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-purple-600 hover:bg-purple-700 text-white disabled:opacity-50`}>
                            {testingEmail ? <Clock className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                            {testingEmail ? 'Sending...' : 'Send Test Email'}
                        </button>
                        <p className="text-xs text-gray-500 mt-2">Test the SMTP configuration by sending a test email.</p>
                    </div>
                </div>
            </SettingCard>
        </div>
    )

    const renderComplianceTab = () => (
        <div className="space-y-5">
            <SettingCard title="GDPR / Privacy" description="Data protection and consent management" icon={Shield}>
                <div className="space-y-4">
                    <Toggle label="Enable GDPR compliance mode" checked={settings.compliance.gdprEnabled}
                        onChange={v => u('compliance', 'gdprEnabled', v)}
                        description="Show consent forms and enable data subject rights" />
                    {settings.compliance.gdprEnabled && (
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Consent Text</label>
                            <textarea value={settings.compliance.gdprConsentText}
                                onChange={e => u('compliance', 'gdprConsentText', e.target.value)}
                                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                                rows={3} placeholder="By checking in, you agree..." />
                        </div>
                    )}
                </div>
            </SettingCard>
            <SettingCard title="Data Retention" description="How long visitor data is stored" icon={Database}>
                <div className="space-y-4">
                    <div className="flex items-center gap-3">
                        <label className="text-sm text-gray-600">Retain visitor data for</label>
                        <input type="number" value={settings.compliance.dataRetentionDays}
                            onChange={e => u('compliance', 'dataRetentionDays', parseInt(e.target.value))}
                            className="w-20 px-2 py-1 border border-gray-200 rounded-lg text-sm text-center" min={30} max={3650} />
                        <span className="text-sm text-gray-600">days</span>
                    </div>
                    <Toggle label="Auto-anonymize expired data" checked={settings.compliance.autoAnonymize}
                        onChange={v => u('compliance', 'autoAnonymize', v)}
                        description="Automatically remove personal data after retention period" />
                    <Toggle label="Audit logging" checked={settings.compliance.auditLogging}
                        onChange={v => u('compliance', 'auditLogging', v)}
                        description="Log all admin actions for compliance auditing" />
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Export Data Format</label>
                        <select value={settings.compliance.exportDataFormat} onChange={e => u('compliance', 'exportDataFormat', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                            <option value="csv">CSV</option>
                            <option value="json">JSON</option>
                            <option value="xlsx">Excel (XLSX)</option>
                        </select>
                    </div>
                </div>
            </SettingCard>
        </div>
    )

    const tabContent = {
        general: renderGeneralTab,
        visitor: renderVisitorTab,
        notifications: renderNotificationsTab,
        integrations: renderIntegrationsTab,
        security: renderSecurityTab,
        kiosk: renderKioskTab,
        email: renderEmailTab,
        compliance: renderComplianceTab,
    }

    return (
        <div className="flex gap-6">
            {/* Sidebar Navigation */}
            <div className="w-56 flex-shrink-0">
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden sticky top-4">
                    <div className="p-3 border-b border-gray-100">
                        <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                            <SettingsIcon className="w-4 h-4" /> Settings
                        </h2>
                    </div>
                    <nav className="p-1.5">
                        {TABS.map(tab => {
                            const Icon = tab.icon
                            const isActive = activeTab === tab.id
                            return (
                                <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors mb-0.5 ${isActive
                                        ? 'bg-blue-50 text-blue-700'
                                        : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                                        }`}>
                                    <Icon className={`w-4 h-4 ${isActive ? 'text-blue-600' : 'text-gray-400'}`} />
                                    {tab.label}
                                    {isActive && <ChevronRight className="w-3 h-3 ml-auto text-blue-400" />}
                                </button>
                            )
                        })}
                    </nav>
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 max-w-3xl space-y-5">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-xl font-bold text-gray-900">{TABS.find(t => t.id === activeTab)?.label} Settings</h1>
                        <p className="text-sm text-gray-500">Configure {TABS.find(t => t.id === activeTab)?.label.toLowerCase()} preferences for your organization</p>
                    </div>
                    <button onClick={handleSave} disabled={saving}
                        className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium transition-all shadow-sm ${saved
                            ? 'bg-green-600 text-white'
                            : 'bg-blue-600 hover:bg-blue-700 text-white'
                            } disabled:opacity-50`}>
                        {saving ? <Clock className="w-4 h-4 animate-spin" /> : saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
                        {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Changes'}
                    </button>
                </div>

                {/* Tab Content */}
                {tabContent[activeTab]?.()}
            </div>
        </div>
    )
}
