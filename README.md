# VMS - Visitor Management System

A standalone visitor management application that can operate independently or connect to the Bharatlytics platform.

## Features

- Visitor registration with face capture
- Visit scheduling and management
- Check-in/Check-out with QR codes
- Visitor badges generation
- Analytics dashboard

## Dual Mode Operation

| Mode | Description |
|------|-------------|
| **Standalone** | Uses own database for companies, employees, entities |
| **Connected** | Syncs employees/entities from Bharatlytics platform |

## Quick Start

```bash
# Install dependencies
pip install -r requirements.txt

# Configure environment
cp .env.example .env

# Run locally
python run.py
```

## Project Structure

```
visitorManagementSystem/
├── app/                          # Main application code
│   ├── api/                      # API routes and endpoints
│   ├── templates/                # HTML templates
│   └── ...
├── docs/                         # Documentation
│   ├── api-reference.md          # Complete API reference
│   ├── mobile-apis.md            # Mobile app integration guide
│   ├── android-sso-quickstart.md # Android SSO setup
│   ├── deployment/               # Deployment guides
│   ├── security/                 # Security documentation
│   └── troubleshooting/          # Debugging & fix guides
├── scripts/                      # Utility scripts
│   ├── seed/                     # Database seeding scripts
│   ├── cleanup/                  # Data cleanup utilities
│   └── debug/                    # Debugging & verification tools
├── tests/                        # Test files
├── manifest.json                 # App manifest for Platform integration
├── requirements.txt              # Python dependencies
├── run.py                        # Application entry point
└── vercel.json                   # Vercel deployment config
```

## Deployment

Deploy to Vercel:
```bash
vercel
```

## Platform Integration

When running in **Connected Mode**, the VMS integrates securely with the Bharatlytics Platform:

- **SSO Authentication**: Users log in via the Platform and are redirected to VMS with a secure JWT token.
- **Secure Data Access**: VMS uses the user's SSO token to fetch data (employees, entities) from the Platform APIs.
- **Data Isolation**: All API requests are scoped to the user's Company ID, ensuring strict data isolation.

### Configuration
Ensure the following environment variables match your Platform configuration:
- `PLATFORM_API_URL`: URL of the Platform API (e.g., `http://localhost:5000`)
- `PLATFORM_JWT_SECRET`: Must match the Platform's `JWT_SECRET` to validate SSO tokens.
