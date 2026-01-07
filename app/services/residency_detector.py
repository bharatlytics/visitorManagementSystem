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
    def get_mode(company_id: str, data_type: str = None) -> ResidencyMode:
        """
        Get residency mode for a company with SAFE DEFAULTS.
        
        IMPORTANT: Actors and Entities are different concepts:
        - ACTORS (people): 'employee', 'visitor'
        - ENTITIES (things/places): 'location', 'zone', 'organization'
        
        CRITICAL SAFETY RULES:
        1. Visitors ALWAYS default to 'app' (stay in VMS)
        2. Employees default to 'platform' only if company not in VMS DB
        3. Entities (locations) default to 'platform' (come from Platform)
        
        Priority:
        1. Check Platform API/manifest for explicit configuration
        2. Check local installations table
        3. Check if company exists in VMS DB
        4. Apply SAFE type-specific defaults
        
        Args:
            company_id: Company ID
            data_type: REQUIRED - Actor type ('employee', 'visitor') or 
                       Entity type ('location', 'zone', 'organization')
            
        Returns:
            'platform' or 'app'
        """
        # SAFETY CHECK: Require data_type
        if not data_type:
            print(f"[ResidencyDetector] WARNING: No data_type provided, defaulting to 'app' for safety")
            return 'app'
        
        # Check if this is an ACTOR or ENTITY
        ACTOR_TYPES = ['employee', 'visitor']
        ENTITY_TYPES = ['location', 'zone', 'organization', 'plant', 'building', 'gate']
        
        # SAFETY RULE 1: Visitors ALWAYS stay in VMS unless explicitly configured otherwise
        if data_type == 'visitor':
            print(f"[ResidencyDetector] Actor 'visitor' - checking for explicit platform configuration")
        
        # Try to get from Platform API (most authoritative)
        try:
            mode = ResidencyDetector._get_from_platform(company_id, data_type)
            if mode:
                print(f"[ResidencyDetector] Platform API returned mode={mode} for {data_type}")
                return mode
        except Exception as e:
            print(f"[ResidencyDetector] Platform API error: {e}")
        
        # Try local installations (second priority)
        try:
            mode = ResidencyDetector._get_from_installations(company_id, data_type)
            if mode:
                print(f"[ResidencyDetector] Local installation mode={mode} for {data_type}")
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
        
        # SAFE DEFAULTS based on data type (ACTORS vs ENTITIES)
        
        # ACTORS (people)
        if data_type == 'visitor':
            # SAFETY RULE: Visitors default to 'app' (stay in VMS)
            # This prevents accidental deletion of visitor data
            print(f"[ResidencyDetector] SAFE DEFAULT: Actor 'visitor' stays in VMS (app mode)")
            return 'app'
        
        elif data_type == 'employee':
            # Employees can default to platform if company not in VMS
            # This is safe because employees are typically managed centrally
            if not company_exists:
                print(f"[ResidencyDetector] Actor 'employee': Company not in VMS DB → platform mode")
                return 'platform'
            else:
                print(f"[ResidencyDetector] Actor 'employee': Company in VMS DB → app mode")
                return 'app'
        
        # ENTITIES (things/places) - always from Platform per manifest
        elif data_type in ENTITY_TYPES:
            # Entities (location, zone, organization, etc.) come from Platform
            # Per manifest configuration, VMS reads entities from Platform
            print(f"[ResidencyDetector] Entity '{data_type}': Always from Platform (platform mode)")
            return 'platform'
        
        else:
            # Unknown data type - safest is 'app'
            print(f"[ResidencyDetector] WARNING: Unknown data_type '{data_type}' → defaulting to 'app' for safety")
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
            
            # Add auth token
            headers = {}
            
            # Try to get from session first
            try:
                platform_token = session.get('platform_token')
                if platform_token:
                    headers['Authorization'] = f'Bearer {platform_token}'
            except RuntimeError:
                # No Flask context - generate token directly
                pass
            
            # If no session token, generate one
            if 'Authorization' not in headers:
                import jwt
                from datetime import timedelta
                
                platform_secret = Config.PLATFORM_JWT_SECRET or Config.JWT_SECRET
                payload = {
                    'sub': 'vms_app_v1',
                    'companyId': company_id,
                    'iss': 'vms',
                    'exp': datetime.utcnow() + timedelta(hours=1)
                }
                platform_token = jwt.encode(payload, platform_secret, algorithm='HS256')
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
