import { useState, useEffect } from 'react'
import { Settings as SettingsIcon, Building, Bell, Shield, Clock, Save, Check, Mail } from 'lucide-react'
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
        enableFaceRecognition: true,
        smtp: {
            host: '',
            port: 587,
            secure: false,
            user: '',
            password: '',
            fromEmail: ''
        }
    })
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [saved, setSaved] = useState(false)
    const [testingEmail, setTestingEmail] = useState(false)
    const [testEmailSent, setTestEmailSent] = useState(false)

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

    const updateSmtpSetting = (key, value) => {
        setSettings(prev => ({
            ...prev,
            smtp: { ...prev.smtp, [key]: value }
        }))
    }

    const handleTestEmail = async () => {
        const testEmail = prompt('Enter email address to send test email to:');
        if (!testEmail) return;

        setTestingEmail(true);
        try {
            await api.post('/settings/test-email', {
                companyId: localStorage.getItem('companyId'),
                toEmail: testEmail
            });
            setTestEmailSent(true);
            setTimeout(() => setTestEmailSent(false), 3000);
            alert('Test email sent successfully! Check your inbox.');
        } catch (err) {
            alert(err.response?.data?.error || 'Failed to send test email. Please check your SMTP settings.');
        } finally {
            setTestingEmail(false);
        }
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

            {/* SMTP Settings */}
            <SettingCard title="Email Configuration (SMTP)" description="Configure SMTP server for sending approval emails">
                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">SMTP Server Host</label>
                        <input
                            type="text"
                            value={settings.smtp?.host || ''}
                            onChange={(e) => updateSmtpSetting('host', e.target.value)}
                            placeholder="smtp.gmail.com"
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Port</label>
                            <input
                                type="number"
                                value={settings.smtp?.port || 587}
                                onChange={(e) => updateSmtpSetting('port', parseInt(e.target.value))}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            />
                        </div>
                        <div className="flex items-end">
                            <Toggle
                                label="Secure Connection (TLS/SSL)"
                                checked={settings.smtp?.secure || false}
                                onChange={(v) => updateSmtpSetting('secure', v)}
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
                        <input
                            type="text"
                            value={settings.smtp?.user || ''}
                            onChange={(e) => updateSmtpSetting('user', e.target.value)}
                            placeholder="your-email@example.com"
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                        <input
                            type="password"
                            value={settings.smtp?.password || ''}
                            onChange={(e) => updateSmtpSetting('password', e.target.value)}
                            placeholder="••••••••"
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">From Email Address</label>
                        <input
                            type="email"
                            value={settings.smtp?.fromEmail || ''}
                            onChange={(e) => updateSmtpSetting('fromEmail', e.target.value)}
                            placeholder="noreply@yourcompany.com"
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                    </div>

                    <div className="pt-2 border-t border-gray-200">
                        <button
                            onClick={handleTestEmail}
                            disabled={testingEmail || !settings.smtp?.host}
                            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${testEmailSent
                                    ? 'bg-green-600 text-white'
                                    : 'bg-purple-600 hover:bg-purple-700 text-white'
                                } disabled:opacity-50 disabled:cursor-not-allowed`}
                        >
                            {testingEmail ? (
                                <Clock className="w-4 h-4 animate-spin" />
                            ) : testEmailSent ? (
                                <Check className="w-4 h-4" />
                            ) : (
                                <Mail className="w-4 h-4" />
                            )}
                            {testingEmail ? 'Sending...' : testEmailSent ? 'Test Email Sent!' : 'Send Test Email'}
                        </button>
                        <p className="text-xs text-gray-500 mt-2">
                            Test the SMTP configuration by sending a test email to any address.
                        </p>
                    </div>
                </div>
            </SettingCard>
        </div>
    )
}
