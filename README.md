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

## Deployment

Deploy to Vercel:
```bash
vercel
```
