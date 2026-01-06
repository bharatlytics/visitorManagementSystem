"""
Residency Detector - Determines data residency mode for companies

Provides simple, reliable detection of whether data should be stored
on Platform or in VMS App database.
"""
from typing import Literal
from datetime import datetime
from flask import session
import requests
from app.config import Config
from app.db import companies_collection
from bson import ObjectId

ResidencyMode = Literal['platform', 'app']


class ResidencyDetector:
    """Detects and manages data residency mode"""
    
    @staticmethod
    def get_mode(company_id: str, entity_type: str = None) -> ResidencyMode:
        """
        Get residency mode for a company.
        
        Priority:
        1. Check Platform API for configuration
        2. Check local installations table
        3. Check if company exists in VMS DB
        4. Default: 'platform'
        
        Args:
            company_id: Company ID
            entity_type: Optional entity type ('employee', 'visitor')
            
        Returns:
            'platform' or 'app'
        """
        # Try to get from Platform API
        try:
            mode = ResidencyDetector._get_from_platform(company_id, entity_type)
            if mode:
                return mode
        except Exception as e:
            print(f"[ResidencyDetector] Platform API error: {e}")
        
        # Try local installations
        try:
            mode = ResidencyDetector._get_from_installations(company_id)
            if mode:
                return mode
        except Exception as e:
            print(f"[ResidencyDetector] Installations check error: {e}")
        
        # Check if company exists in VMS DB
        try:
            if ResidencyDetector._company_exists_in_vms(company_id):
                print(f"[ResidencyDetector] Company {company_id} found in VMS DB → app mode")
                return 'app'
        except Exception as e:
            print(f"[ResidencyDetector] VMS DB check error: {e}")
        
        # Default to platform
        print(f"[ResidencyDetector] Company {company_id} not in VMS DB → platform mode (default)")
        return 'platform'
    
    @staticmethod
    def _get_from_platform(company_id: str, entity_type: str = None) -> ResidencyMode:
        """Get residency mode from Platform API"""
        try:
            url = f"{Config.PLATFORM_API_URL}/bharatlytics/integration/v1/installations/mapping"
            params = {
                'companyId': company_id,
                'appId': 'vms_app_v1'  # TODO: Get from manifest
            }
            
            # Add auth token if available
            headers = {}
            platform_token = session.get('platform_token')
            if platform_token:
                headers['Authorization'] = f'Bearer {platform_token}'
            
            response = requests.get(url, params=params, headers=headers, timeout=5)
            
            if response.status_code == 200:
                data = response.json()
                mapping = data.get('mapping', {})
                residency_mode = mapping.get('residencyMode', {})
                
                if entity_type:
                    actor_key = f'actor_{entity_type}'
                    actor_config = residency_mode.get(actor_key, {})
                    mode = actor_config.get('mode', 'platform')
                else:
                    # Get general mode
                    mode = residency_mode.get('mode', 'platform')
                
                print(f"[ResidencyDetector] Platform API returned mode={mode}")
                return mode
        except Exception as e:
            print(f"[ResidencyDetector] Platform API failed: {e}")
            return None
    
    @staticmethod
    def _get_from_installations(company_id: str) -> ResidencyMode:
        """Get residency mode from local installations table"""
        from app.db import db
        
        installation = db['installations'].find_one({'company_id': company_id})
        if installation and installation.get('residency_mode'):
            mode = installation['residency_mode']
            print(f"[ResidencyDetector] Local installation mode={mode}")
            return mode
        return None
    
    @staticmethod
    def _company_exists_in_vms(company_id: str) -> bool:
        """Check if company exists in VMS database"""
        try:
            # Try ObjectId first
            company = companies_collection.find_one({'_id': ObjectId(company_id)})
        except:
            # Try string ID
            company = companies_collection.find_one({'_id': company_id})
        
        return company is not None
    
    @staticmethod
    def is_platform_mode(company_id: str, entity_type: str = None) -> bool:
        """Check if company is in platform mode"""
        return ResidencyDetector.get_mode(company_id, entity_type) == 'platform'
    
    @staticmethod
    def is_app_mode(company_id: str, entity_type: str = None) -> bool:
        """Check if company is in app mode"""
        return ResidencyDetector.get_mode(company_id, entity_type) == 'app'
    
    @staticmethod
    def set_mode(company_id: str, mode: ResidencyMode):
        """
        Set residency mode for a company (stored locally).
        This is a fallback when Platform API is not available.
        """
        from app.db import db
        
        db['installations'].update_one(
            {'company_id': company_id},
            {
                '$set': {
                    'company_id': company_id,
                    'residency_mode': mode,
                    'updated_at': datetime.utcnow()
                },
                '$setOnInsert': {
                    'created_at': datetime.utcnow()
                }
            },
            upsert=True
        )
        print(f"[ResidencyDetector] Set mode={mode} for company {company_id}")
