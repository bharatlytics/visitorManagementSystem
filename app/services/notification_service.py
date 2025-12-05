"""
VMS Notification Service
Handles notifications for visit events via email and SMS
"""
import os


class NotificationService:
    """Notification service for VMS events with email and SMS support"""
    
    @staticmethod
    def send_email(to_email, subject, template_name, **kwargs):
        """
        Send an email using the configured SMTP server.
        For now, this is a mock implementation that logs to console.
        """
        try:
            body = f"Notification: {subject}\n\n" + "\n".join([f"{k}: {v}" for k, v in kwargs.items()])
            
            print(f"==================================================")
            print(f"MOCK EMAIL SENDING")
            print(f"To: {to_email}")
            print(f"Subject: {subject}")
            print(f"Body: {body}")
            print(f"==================================================")
            
            # TODO: Implement actual SMTP sending
            # msg = Message(subject, recipients=[to_email])
            # msg.html = body
            # mail.send(msg)
            
            return True
        except Exception as e:
            print(f"Error sending email: {e}")
            return False

    @staticmethod
    def send_sms(to_phone, message):
        """
        Send an SMS using Twilio.
        For now, this is a mock implementation that logs to console.
        """
        try:
            print(f"==================================================")
            print(f"MOCK SMS SENDING")
            print(f"To: {to_phone}")
            print(f"Message: {message}")
            print(f"==================================================")
            
            # TODO: Implement Twilio sending
            # client = Client(current_app.config['TWILIO_ACCOUNT_SID'], current_app.config['TWILIO_AUTH_TOKEN'])
            # client.messages.create(body=message, from_=current_app.config['TWILIO_PHONE_NUMBER'], to=to_phone)
            
            return True
        except Exception as e:
            print(f"Error sending SMS: {e}")
            return False

    @staticmethod
    def notify_visit_scheduled(visit, visitor, host):
        """
        Notify visitor and host about a scheduled visit.
        """
        # Notify Visitor
        if visitor.get('email'):
            NotificationService.send_email(
                visitor['email'],
                'Visit Scheduled - Bharatlytics',
                'visit_scheduled.html',
                visitor_name=visitor.get('visitorName'),
                host_name=host.get('employeeName'),
                date=visit.get('expectedArrival'),
                location=host.get('location', 'Main Office')
            )
        
        if visitor.get('phone'):
            msg = f"Hi {visitor.get('visitorName')}, your visit to Bharatlytics is scheduled for {visit.get('expectedArrival')}. Host: {host.get('employeeName')}."
            NotificationService.send_sms(visitor['phone'], msg)

        # Notify Host
        if host.get('email'):
            NotificationService.send_email(
                host['email'],
                'New Visit Scheduled',
                'host_visit_scheduled.html',
                visitor_name=visitor.get('visitorName'),
                date=visit.get('expectedArrival'),
                purpose=visit.get('purpose')
            )

    @staticmethod
    def notify_check_in(visit, visitor, host):
        """
        Notify host that visitor has checked in.
        """
        if host.get('email'):
            NotificationService.send_email(
                host['email'],
                'Visitor Checked In',
                'visitor_checked_in.html',
                visitor_name=visitor.get('visitorName'),
                time=visit.get('actualArrival')
            )
        
        if host.get('phone'):
            msg = f"Your visitor {visitor.get('visitorName')} has arrived and checked in."
            NotificationService.send_sms(host['phone'], msg)

    @staticmethod
    def notify_check_out(visit, visitor, host):
        """
        Notify host that visitor has checked out.
        """
        # Optional: Notify host
        if host and host.get('email'):
            NotificationService.send_email(
                host['email'],
                'Visitor Checked Out',
                'visitor_checked_out.html',
                visitor_name=visitor.get('visitorName'),
                time=visit.get('actualDeparture')
            )
