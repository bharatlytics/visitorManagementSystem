"""
Test script to verify residency detection for entities
"""
import sys
sys.path.insert(0, 'c:\\Users\\sahil\\OneDrive\\Documents\\GitHub\\visitorManagementSystem')

from app.services.residency_detector import ResidencyDetector

# Test with a company ID
company_id = "6827296ab6e06b08639107c4"

print("="*60)
print("Testing Residency Detection")
print("="*60)

# Test for 'location' entity type
mode = ResidencyDetector.get_mode(company_id, 'location')
print(f"\nResult: mode = '{mode}'")
print(f"Expected: 'platform'")
print(f"Match: {mode == 'platform'}")

print("\n" + "="*60)
