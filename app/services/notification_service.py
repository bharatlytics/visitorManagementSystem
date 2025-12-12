import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime
import threading
from app.config import Config

class NotificationService:
    """
    Service to handle notifications (Email, SMS, etc.)
    Currently supports Email via SMTP with console fallback.
    """

    @staticmethod
    def send_email(to_email, subject, body):
        """Send email in a separate thread to avoid blocking"""
        thread = threading.Thread(target=NotificationService._send_email_sync, args=(to_email, subject, body))
        thread.start()

    @staticmethod
    def _send_email_sync(to_email, subject, body):
        """Synchronous email sending logic"""
        if not Config.MAIL_USERNAME or not Config.MAIL_PASSWORD:
            print(f"\n[NotificationService] SMTP not configured. Mocking email to {to_email}:")
            print(f"Subject: {subject}")
            print(f"Body: {body}\n")
            return

        try:
            msg = MIMEMultipart()
            msg['From'] = Config.MAIL_DEFAULT_SENDER
            msg['To'] = to_email
            msg['Subject'] = subject

            msg.attach(MIMEText(body, 'html'))

            server = smtplib.SMTP(Config.MAIL_SERVER, Config.MAIL_PORT)
            if Config.MAIL_USE_TLS:
                server.starttls()
            
            server.login(Config.MAIL_USERNAME, Config.MAIL_PASSWORD)
            server.send_message(msg)
            server.quit()
            print(f"[NotificationService] Email sent to {to_email}")
        except Exception as e:
            print(f"[NotificationService] Failed to send email: {e}")

    @staticmethod
    def notify_visit_scheduled(visit, visitor, host):
        """Notify host about a new scheduled visit"""
        if not host.get('email'):
            print(f"[NotificationService] Host {host.get('employeeName')} has no email. Skipping notification.")
            return

        subject = f"New Visitor Scheduled: {visitor.get('visitorName')}"
        
        arrival_time = visit.get('expectedArrival')
        if isinstance(arrival_time, str):
            try:
                # Try to parse ISO format for better display
                dt = datetime.fromisoformat(arrival_time.replace('Z', '+00:00'))
                arrival_time = dt.strftime('%Y-%m-%d %H:%M')
            except:
                pass

        body = f"""
        <h3>New Visit Scheduled</h3>
        <p>Hello {host.get('employeeName')},</p>
        <p>A new visitor has been scheduled to see you.</p>
        <ul>
            <li><strong>Visitor:</strong> {visitor.get('visitorName')}</li>
            <li><strong>Organization:</strong> {visitor.get('organization', 'N/A')}</li>
            <li><strong>Purpose:</strong> {visit.get('purpose', 'N/A')}</li>
            <li><strong>Expected Arrival:</strong> {arrival_time}</li>
        </ul>
        <p>Please approve this visit in your dashboard if required.</p>
        <br>
        <p>Best regards,<br>VMS Team</p>
        """
        
        NotificationService.send_email(host['email'], subject, body)

    @staticmethod
    def notify_check_in(visit, visitor, host):
        """Notify host that visitor has arrived"""
        if not host.get('email'):
            print(f"[NotificationService] Host {host.get('employeeName')} has no email. Skipping notification.")
            return

        subject = f"Visitor Arrived: {visitor.get('visitorName')}"
        
        body = f"""
        <h3>Visitor Arrived</h3>
        <p>Hello {host.get('employeeName')},</p>
        <p><strong>{visitor.get('visitorName')}</strong> has just checked in at the reception.</p>
        <ul>
            <li><strong>Organization:</strong> {visitor.get('organization', 'N/A')}</li>
            <li><strong>Purpose:</strong> {visit.get('purpose', 'N/A')}</li>
        </ul>
        <p>Please proceed to the reception to receive them.</p>
        <br>
        <p>Best regards,<br>VMS Team</p>
        """
        
        NotificationService.send_email(host['email'], subject, body)
