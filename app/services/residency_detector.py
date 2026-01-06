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
        Get residency mode for a company with SAFE DEFAULTS.
        
        CRITICAL SAFETY RULES:
        1. Visitors ALWAYS default to 'app' (stay in VMS)
        2. Employees default to 'platform' only if explicitly configured
        3. Never delete data without explicit confirmation
        
        Priority:
        1. Check Platform API for explicit configuration
        2. Check local installations table
        3. Check if company exists in VMS DB
        4. Apply SAFE entity-specific defaults
        
        Args:
            company_id: Company ID
            entity_type: REQUIRED - 'employee' or 'visitor'
            
        Returns:
            'platform' or 'app'
        """
        # SAFETY CHECK: Require entity_type
        if not entity_type:
            print(f"[ResidencyDetector] WARNING: No entity_type provided, defaulting to 'app' for safety")
            return 'app'
        
        # SAFETY RULE 1: Visitors ALWAYS stay in VMS unless explicitly configured otherwise
        if entity_type == 'visitor':
            print(f"[ResidencyDetector] Visitor entity - checking for explicit platform configuration")
        
        # Try to get from Platform API (most authoritative)
        try:
            mode = ResidencyDetector._get_from_platform(company_id, entity_type)
            if mode:
                print(f"[ResidencyDetector] Platform API returned mode={mode} for {entity_type}")
                return mode
        except Exception as e:
            print(f"[ResidencyDetector] Platform API error: {e}")
        
        # Try local installations (second priority)
        try:
            mode = ResidencyDetector._get_from_installations(company_id, entity_type)
            if mode:
                print(f"[ResidencyDetector] Local installation mode={mode} for {entity_type}")
                return mode
        except Exception as e:
            print(f"[ResidencyDetector] Installations check error: {e}")
        
        # Check if company exists in VMS DB
        company_exists = False
        try:
            company_exists = ResidencyDetector._company_exists_in_vms(company_id)
            if company_exists:
                print(f"[ResidencyDetector] Company {company_id} found in VMS DB → app mode")
                return 'app'
        except Exception as e:
            print(f"[ResidencyDetector] VMS DB check error: {e}")
        
        # SAFE DEFAULTS based on entity type
        if entity_type == 'visitor':
            # SAFETY RULE: Visitors default to 'app' (stay in VMS)
            # This prevents accidental deletion of visitor data
            print(f"[ResidencyDetector] SAFE DEFAULT: Visitors stay in VMS (app mode)")
            return 'app'
        
        elif entity_type == 'employee':
            # Employees can default to platform if company not in VMS
            # This is safe because employees are typically managed centrally
            if not company_exists:
                print(f"[ResidencyDetector] Company {company_id} not in VMS DB → platform mode for employees")
                return 'platform'
            else:
                print(f"[ResidencyDetector] Company {company_id} in VMS DB → app mode for employees")
                return 'app'
        
        else:
            # Unknown entity type - safest is 'app'
            print(f"[ResidencyDetector] WARNING: Unknown entity_type '{entity_type}' → defaulting to 'app' for safety")
            return 'app'
    
    @staticmethod
    def _get_from_platform(company_id: str, entity_type: str = None) -> ResidencyMode:
        """Get residency mode from Platform API manifest"""
        try:
            url = f"{Config.PLATFORM_API_URL}/bharatlytics/integration/v1/installations/mapping"
            params = {
                'companyId': company_id,
                'appId': 'vms_app_v1'
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
                
                # Check for entity-specific residency mode
                if entity_type:
                    # Look for entity requirements in manifest
                    entity_requirements = mapping.get('entityRequirements', {})
                    
                    # Check if this entity type has a specific source configured
                    for entity_config in entity_requirements:
                        if entity_config.get('name', '').lower() == entity_type.lower():
                            source = entity_config.get('source', 'Platform')
                            
                            # Map source to residency mode
                            if source == 'Platform':
                                print(f"[ResidencyDetector] Manifest: {entity_type} source=Platform → mode=platform")
                                return 'platform'
                            elif source == 'Visitor Management System':
                                print(f"[ResidencyDetector] Manifest: {entity_type} source=VMS → mode=app")
                                return 'app'
                    
                    # Fallback: check old residencyMode structure
                    residency_mode = mapping.get('residencyMode', {})
                    actor_key = f'actor_{entity_type}'
                    actor_config = residency_mode.get(actor_key, {})
                    mode = actor_config.get('mode')
                    
                    if mode:
                        print(f"[ResidencyDetector] Platform API returned mode={mode} for {entity_type}")
                        return mode
                
                # No entity-specific config found
                return None
                
        except Exception as e:
            print(f"[ResidencyDetector] Platform API failed: {e}")
            return None
    
    @staticmethod
    def _get_from_installations(company_id: str, entity_type: str = None) -> ResidencyMode:
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
