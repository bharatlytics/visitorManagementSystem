"""
Test manifest-based residency detection
"""
from app.services.residency_detector import ResidencyDetector


def test_manifest_residency():
    """Test that residency detector reads from manifest"""
    print("\n" + "="*70)
    print("TEST: Manifest-Based Residency Detection")
    print("="*70)
    
    company_id = '6827296ab6e06b08639107c4'
    
    # Test all entity types
    entities = ['employee', 'visitor', 'location']
    
    for entity_type in entities:
        mode = ResidencyDetector.get_mode(company_id, entity_type)
        print(f"\n{entity_type.capitalize()}:")
        print(f"  Residency Mode: {mode}")
        
        # Expected based on manifest:
        # - employee: Platform (source=Platform)
        # - visitor: VMS (source=Visitor Management System)
        # - location: Platform (source=Platform)
        
        if entity_type == 'employee':
            expected = 'platform'
        elif entity_type == 'visitor':
            expected = 'app'
        elif entity_type == 'location':
            expected = 'platform'
        
        status = "✅" if mode == expected else "❌"
        print(f"  Expected: {expected} {status}")
    
    print("\n" + "="*70)


if __name__ == '__main__':
    test_manifest_residency()
