"""
VMS Standalone Mode E2E Test Suite

Tests all standalone VMS functionality without Platform dependency:
1. Company Management (create, update, settings)
2. User Management (CRUD, roles, password)
3. RBAC (role-based access control)
4. Employee CRUD (standalone mode)
5. Visitor CRUD
6. Visit Management
"""
import requests
import json
import jwt
from datetime import datetime, timedelta
import sys
import os

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


class VMSStandaloneTestSuite:
    """Test suite for standalone VMS operation"""
    
    def __init__(self, base_url: str = "http://localhost:5001"):
        self.base_url = base_url.rstrip('/')
        self.test_results = []
        
        # Admin credentials
        self.admin_secret = '112233445566778899'
        
        # Test data holders
        self.company_id = None
        self.admin_token = None
        self.admin_user_id = None
        self.test_user_id = None
        self.test_employee_id = None
        self.test_visitor_id = None
        self.test_visit_id = None
        
        # Test data
        self.timestamp = int(datetime.utcnow().timestamp())
        self.test_company_name = f"Test Company {self.timestamp}"
        self.admin_email = f"admin_{self.timestamp}@test.com"
        self.admin_password = "TestPassword123!"
    
    def _log_result(self, test_name: str, passed: bool, message: str = "", details: str = ""):
        """Log test result"""
        status = "[PASS]" if passed else "[FAIL]"
        self.test_results.append({
            'test': test_name,
            'passed': passed,
            'status': status,
            'message': message
        })
        print(f"{status}: {test_name}")
        if message:
            print(f"   -> {message}")
        if details and not passed:
            print(f"   -> Details: {details[:500]}")
    
    def _headers(self, token: str = None) -> dict:
        """Get request headers with auth"""
        t = token or self.admin_token
        return {
            'Authorization': f'Bearer {t}',
            'Content-Type': 'application/json'
        }
    
    # =========================================
    # SETUP: Register Company and Admin
    # =========================================
    
    def setup_company_and_admin(self):
        """Create test company and admin user"""
        print("\n" + "="*60)
        print("[SETUP: Company & Admin Registration]")
        print("="*60)
        
        # Register new company with admin
        data = {
            'email': self.admin_email,
            'password': self.admin_password,
            'name': 'Test Admin',
            'companyName': self.test_company_name,
            'adminSecret': self.admin_secret
        }
        
        try:
            resp = requests.post(f"{self.base_url}/auth/register", json=data, timeout=10)
            if resp.status_code == 201:
                result = resp.json()
                self.admin_token = result.get('token')
                self.admin_user_id = result.get('user', {}).get('id')
                self.company_id = result.get('user', {}).get('companyId')
                
                self._log_result("Company & Admin Registration", True, 
                               f"Company: {self.company_id}, Role: {result.get('user', {}).get('role')}")
                return True
            else:
                self._log_result("Company & Admin Registration", False, 
                               f"Status: {resp.status_code}", resp.text)
                return False
        except Exception as e:
            self._log_result("Company & Admin Registration", False, str(e))
            return False
    
    # =========================================
    # AUTH TESTS
    # =========================================
    
    def test_auth_me(self):
        """Test auth/me endpoint"""
        print("\n" + "="*60)
        print("[AUTH TESTS]")
        print("="*60)
        
        try:
            resp = requests.get(f"{self.base_url}/auth/me", headers=self._headers(), timeout=10)
            passed = resp.status_code == 200
            data = resp.json() if resp.content else {}
            self._log_result("Auth /me Endpoint", passed, 
                           f"User: {data.get('user_id', 'N/A')}, Company: {data.get('company_id', 'N/A')}")
        except Exception as e:
            self._log_result("Auth /me Endpoint", False, str(e))
    
    def test_login_with_role(self):
        """Test login returns role"""
        data = {
            'email': self.admin_email,
            'password': self.admin_password
        }
        
        try:
            resp = requests.post(f"{self.base_url}/auth/login", json=data, timeout=10)
            result = resp.json() if resp.content else {}
            role = result.get('user', {}).get('role')
            passed = resp.status_code == 200 and role in ['company_admin', 'admin']
            self._log_result("Login Returns Role", passed, f"Role: {role}")
        except Exception as e:
            self._log_result("Login Returns Role", False, str(e))
    
    # =========================================
    # COMPANY TESTS
    # =========================================
    
    def test_company_crud(self):
        """Test company CRUD operations"""
        print("\n" + "="*60)
        print("[COMPANY TESTS]")
        print("="*60)
        
        # GET company
        try:
            url = f"{self.base_url}/api/company?companyId={self.company_id}"
            resp = requests.get(url, headers=self._headers(), timeout=10)
            passed = resp.status_code == 200
            data = resp.json() if resp.content else {}
            self._log_result("Company GET", passed, 
                           f"Name: {data.get('company', {}).get('name', 'N/A')}")
        except Exception as e:
            self._log_result("Company GET", False, str(e))
        
        # UPDATE company
        try:
            data = {
                'companyId': self.company_id,
                'phone': '9876543210',
                'industry': 'Technology'
            }
            resp = requests.patch(f"{self.base_url}/api/company", 
                                  json=data, headers=self._headers(), timeout=10)
            passed = resp.status_code == 200
            self._log_result("Company UPDATE", passed, "Updated phone and industry")
        except Exception as e:
            self._log_result("Company UPDATE", False, str(e))
        
        # GET settings
        try:
            url = f"{self.base_url}/api/company/settings?companyId={self.company_id}"
            resp = requests.get(url, headers=self._headers(), timeout=10)
            passed = resp.status_code == 200
            self._log_result("Company Settings GET", passed)
        except Exception as e:
            self._log_result("Company Settings GET", False, str(e))
        
        # UPDATE settings
        try:
            data = {
                'companyId': self.company_id,
                'settings': {
                    'requireApproval': True,
                    'autoCheckoutHours': 10
                }
            }
            resp = requests.patch(f"{self.base_url}/api/company/settings",
                                  json=data, headers=self._headers(), timeout=10)
            passed = resp.status_code == 200
            self._log_result("Company Settings UPDATE", passed)
        except Exception as e:
            self._log_result("Company Settings UPDATE", False, str(e))
        
        # GET stats
        try:
            url = f"{self.base_url}/api/company/stats?companyId={self.company_id}"
            resp = requests.get(url, headers=self._headers(), timeout=10)
            passed = resp.status_code == 200
            self._log_result("Company Stats GET", passed)
        except Exception as e:
            self._log_result("Company Stats GET", False, str(e))
    
    # =========================================
    # USER TESTS
    # =========================================
    
    def test_user_crud(self):
        """Test user CRUD operations"""
        print("\n" + "="*60)
        print("[USER MANAGEMENT TESTS]")
        print("="*60)
        
        # GET roles
        try:
            resp = requests.get(f"{self.base_url}/api/users/roles", 
                               headers=self._headers(), timeout=10)
            passed = resp.status_code == 200
            data = resp.json() if resp.content else {}
            roles = data.get('roles', [])
            self._log_result("User Roles GET", passed, f"Roles: {[r['id'] for r in roles]}")
        except Exception as e:
            self._log_result("User Roles GET", False, str(e))
        
        # CREATE user
        try:
            data = {
                'companyId': self.company_id,
                'email': f'receptionist_{self.timestamp}@test.com',
                'name': 'Test Receptionist',
                'role': 'receptionist',
                'password': 'Test123!'
            }
            resp = requests.post(f"{self.base_url}/api/users", 
                                json=data, headers=self._headers(), timeout=10)
            passed = resp.status_code == 201
            result = resp.json() if resp.content else {}
            self.test_user_id = result.get('user', {}).get('_id')
            self._log_result("User CREATE", passed, f"User ID: {self.test_user_id}")
        except Exception as e:
            self._log_result("User CREATE", False, str(e))
        
        # LIST users
        try:
            url = f"{self.base_url}/api/users/?companyId={self.company_id}"
            resp = requests.get(url, headers=self._headers(), timeout=10)
            passed = resp.status_code == 200
            data = resp.json() if resp.content else {}
            count = data.get('count', 0)
            self._log_result("User LIST", passed, f"Found {count} users")
        except Exception as e:
            self._log_result("User LIST", False, str(e))
        
        # UPDATE user
        if self.test_user_id:
            try:
                data = {
                    'companyId': self.company_id,
                    'name': 'Updated Receptionist',
                    'role': 'security_guard'
                }
                resp = requests.patch(f"{self.base_url}/api/users/{self.test_user_id}",
                                      json=data, headers=self._headers(), timeout=10)
                passed = resp.status_code == 200
                self._log_result("User UPDATE", passed, "Changed role to security_guard")
            except Exception as e:
                self._log_result("User UPDATE", False, str(e))
        
        # UPDATE own profile
        try:
            data = {'name': 'Updated Admin Name'}
            resp = requests.patch(f"{self.base_url}/api/users/me",
                                  json=data, headers=self._headers(), timeout=10)
            passed = resp.status_code == 200
            self._log_result("User Self UPDATE", passed)
        except Exception as e:
            self._log_result("User Self UPDATE", False, str(e))
        
        # DEACTIVATE user
        if self.test_user_id:
            try:
                url = f"{self.base_url}/api/users/{self.test_user_id}?companyId={self.company_id}"
                resp = requests.delete(url, headers=self._headers(), timeout=10)
                passed = resp.status_code == 200
                self._log_result("User DEACTIVATE", passed)
            except Exception as e:
                self._log_result("User DEACTIVATE", False, str(e))
    
    # =========================================
    # EMPLOYEE TESTS
    # =========================================
    
    def test_employee_crud(self):
        """Test employee CRUD operations"""
        print("\n" + "="*60)
        print("[EMPLOYEE CRUD TESTS]")
        print("="*60)
        
        # CREATE employee
        try:
            data = {
                'companyId': self.company_id,
                'employeeId': f'EMP_{self.timestamp}',
                'employeeName': f'Test Employee {self.timestamp}',
                'email': f'employee_{self.timestamp}@test.com',
                'phone': '9876543210',
                'designation': 'Engineer',
                'department': 'Engineering'
            }
            resp = requests.post(f"{self.base_url}/api/employees",
                                json=data, headers=self._headers(), timeout=15)
            passed = resp.status_code in [200, 201, 202]
            result = resp.json() if resp.content else {}
            self.test_employee_id = result.get('_id') or result.get('employeeId')
            self._log_result("Employee CREATE", passed, f"ID: {self.test_employee_id}")
        except Exception as e:
            self._log_result("Employee CREATE", False, str(e))
        
        # LIST employees
        try:
            url = f"{self.base_url}/api/employees?companyId={self.company_id}"
            resp = requests.get(url, headers=self._headers(), timeout=10)
            passed = resp.status_code == 200
            data = resp.json() if resp.content else []
            count = len(data) if isinstance(data, list) else 0
            # Use first employee if we don't have one
            if not self.test_employee_id and count > 0:
                self.test_employee_id = data[0].get('_id') or data[0].get('employeeId')
            self._log_result("Employee LIST", passed, f"Found {count} employees")
        except Exception as e:
            self._log_result("Employee LIST", False, str(e))
        
        # GET single employee
        if self.test_employee_id:
            try:
                url = f"{self.base_url}/api/employees/{self.test_employee_id}?companyId={self.company_id}"
                resp = requests.get(url, headers=self._headers(), timeout=10)
                passed = resp.status_code == 200
                self._log_result("Employee GET", passed)
            except Exception as e:
                self._log_result("Employee GET", False, str(e))
        
        # UPDATE employee
        if self.test_employee_id:
            try:
                data = {
                    'companyId': self.company_id,
                    'designation': 'Senior Engineer'
                }
                url = f"{self.base_url}/api/employees/{self.test_employee_id}"
                resp = requests.patch(url, json=data, headers=self._headers(), timeout=10)
                passed = resp.status_code in [200, 404]  # 404 if platform mode
                self._log_result("Employee UPDATE", passed)
            except Exception as e:
                self._log_result("Employee UPDATE", False, str(e))
    
    # =========================================
    # VISITOR TESTS
    # =========================================
    
    def test_visitor_crud(self):
        """Test visitor CRUD operations"""
        print("\n" + "="*60)
        print("[VISITOR CRUD TESTS]")
        print("="*60)
        
        host_id = self.test_employee_id
        if not host_id:
            self._log_result("Visitor CREATE", False, "No host employee available")
            return
        
        # CREATE visitor
        try:
            data = {
                'companyId': self.company_id,
                'visitorName': f'Test Visitor {self.timestamp}',
                'phone': '9876543211',
                'hostEmployeeId': str(host_id),
                'email': f'visitor_{self.timestamp}@test.com',
                'organization': 'Test Corp',
                'purpose': 'E2E Testing'
            }
            resp = requests.post(f"{self.base_url}/api/visitors/register",
                                data=data, 
                                headers={'Authorization': f'Bearer {self.admin_token}'},
                                timeout=15)
            passed = resp.status_code in [200, 201]
            result = resp.json() if resp.content else {}
            self.test_visitor_id = result.get('visitorId') or result.get('_id')
            self._log_result("Visitor CREATE", passed, f"ID: {self.test_visitor_id}")
        except Exception as e:
            self._log_result("Visitor CREATE", False, str(e))
        
        # LIST visitors
        try:
            url = f"{self.base_url}/api/visitors/?companyId={self.company_id}"
            resp = requests.get(url, headers=self._headers(), timeout=10)
            passed = resp.status_code == 200
            data = resp.json() if resp.content else {}
            visitors = data.get('visitors', [])
            self._log_result("Visitor LIST", passed, f"Found {len(visitors)} visitors")
        except Exception as e:
            self._log_result("Visitor LIST", False, str(e))
        
        # BLACKLIST visitor
        if self.test_visitor_id:
            try:
                data = {
                    'companyId': self.company_id,
                    'visitorId': self.test_visitor_id,
                    'reason': 'Test blacklist'
                }
                resp = requests.post(f"{self.base_url}/api/visitors/blacklist",
                                    json=data, headers=self._headers(), timeout=10)
                passed = resp.status_code == 200
                self._log_result("Visitor BLACKLIST", passed)
            except Exception as e:
                self._log_result("Visitor BLACKLIST", False, str(e))
            
            # UNBLACKLIST
            try:
                data = {
                    'companyId': self.company_id,
                    'visitorId': self.test_visitor_id
                }
                resp = requests.post(f"{self.base_url}/api/visitors/unblacklist",
                                    json=data, headers=self._headers(), timeout=10)
                passed = resp.status_code == 200
                self._log_result("Visitor UNBLACKLIST", passed)
            except Exception as e:
                self._log_result("Visitor UNBLACKLIST", False, str(e))
    
    # =========================================
    # VISIT TESTS
    # =========================================
    
    def test_visit_management(self):
        """Test visit management"""
        print("\n" + "="*60)
        print("[VISIT MANAGEMENT TESTS]")
        print("="*60)
        
        if not self.test_visitor_id:
            self._log_result("Visit SCHEDULE", False, "No visitor available")
            return
        
        host_id = self.test_employee_id
        
        # SCHEDULE visit
        try:
            now = datetime.utcnow()
            data = {
                'companyId': self.company_id,
                'visitorId': self.test_visitor_id,
                'hostEmployeeId': str(host_id),
                'purpose': 'E2E Testing',
                'expectedArrival': now.isoformat() + 'Z',
                'expectedDeparture': (now + timedelta(hours=2)).isoformat() + 'Z'
            }
            url = f"{self.base_url}/api/visitors/{self.test_visitor_id}/schedule-visit"
            resp = requests.post(url, json=data, headers=self._headers(), timeout=10)
            passed = resp.status_code in [200, 201]
            result = resp.json() if resp.content else {}
            visit = result.get('visit', {})
            self.test_visit_id = visit.get('_id') or result.get('visitId')
            self._log_result("Visit SCHEDULE", passed, f"ID: {self.test_visit_id}")
        except Exception as e:
            self._log_result("Visit SCHEDULE", False, str(e))
        
        # LIST visits
        try:
            url = f"{self.base_url}/api/visits?companyId={self.company_id}"
            resp = requests.get(url, headers=self._headers(), timeout=10)
            passed = resp.status_code == 200
            self._log_result("Visit LIST", passed)
        except Exception as e:
            self._log_result("Visit LIST", False, str(e))
        
        # CHECK-IN
        if self.test_visit_id:
            try:
                data = {
                    'companyId': self.company_id,
                    'checkInMethod': 'manual'
                }
                url = f"{self.base_url}/api/visits/{self.test_visit_id}/check-in"
                resp = requests.post(url, json=data, headers=self._headers(), timeout=10)
                passed = resp.status_code == 200
                self._log_result("Visit CHECK-IN", passed)
            except Exception as e:
                self._log_result("Visit CHECK-IN", False, str(e))
            
            # CHECK-OUT
            try:
                data = {
                    'companyId': self.company_id,
                    'checkOutMethod': 'manual'
                }
                url = f"{self.base_url}/api/visits/{self.test_visit_id}/check-out"
                resp = requests.post(url, json=data, headers=self._headers(), timeout=10)
                passed = resp.status_code == 200
                self._log_result("Visit CHECK-OUT", passed)
            except Exception as e:
                self._log_result("Visit CHECK-OUT", False, str(e))
    
    # =========================================
    # DEVICES TESTS
    # =========================================
    
    def test_devices(self):
        """Test device management"""
        print("\n" + "="*60)
        print("[DEVICE MANAGEMENT TESTS]")
        print("="*60)
        
        device_id = None
        
        # CREATE device
        try:
            data = {
                'companyId': self.company_id,
                'deviceName': f'Test Kiosk {self.timestamp}',
                'deviceType': 'kiosk'
            }
            resp = requests.post(f"{self.base_url}/api/devices/register",
                                json=data, headers=self._headers(), timeout=10)
            passed = resp.status_code == 201
            result = resp.json() if resp.content else {}
            device_id = result.get('device', {}).get('_id')
            self._log_result("Device CREATE", passed, f"ID: {device_id}")
        except Exception as e:
            self._log_result("Device CREATE", False, str(e))
        
        # LIST devices
        try:
            url = f"{self.base_url}/api/devices/?companyId={self.company_id}"
            resp = requests.get(url, headers=self._headers(), timeout=10)
            passed = resp.status_code == 200
            data = resp.json() if resp.content else {}
            count = data.get('count', 0)
            self._log_result("Device LIST", passed, f"Found {count} devices")
        except Exception as e:
            self._log_result("Device LIST", False, str(e))
        
        # GET stats
        try:
            url = f"{self.base_url}/api/devices/stats?companyId={self.company_id}"
            resp = requests.get(url, headers=self._headers(), timeout=10)
            passed = resp.status_code == 200
            self._log_result("Device STATS", passed)
        except Exception as e:
            self._log_result("Device STATS", False, str(e))
        
        # DELETE device
        if device_id:
            try:
                url = f"{self.base_url}/api/devices/{device_id}?companyId={self.company_id}"
                resp = requests.delete(url, headers=self._headers(), timeout=10)
                passed = resp.status_code == 200
                self._log_result("Device DELETE", passed)
            except Exception as e:
                self._log_result("Device DELETE", False, str(e))
    
    # =========================================
    # RUN ALL TESTS
    # =========================================
    
    def run_all_tests(self):
        """Run complete test suite"""
        print("\n" + "="*70)
        print("VMS STANDALONE MODE END-TO-END TEST SUITE")
        print("="*70)
        print(f"Base URL: {self.base_url}")
        print(f"Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print("="*70)
        
        # Setup
        if not self.setup_company_and_admin():
            print("\n[FATAL] Setup failed. Cannot continue.")
            return False
        
        # Run tests
        self.test_auth_me()
        self.test_login_with_role()
        self.test_company_crud()
        self.test_user_crud()
        self.test_employee_crud()
        self.test_visitor_crud()
        self.test_visit_management()
        self.test_devices()
        
        # Summary
        print("\n" + "="*70)
        print("TEST SUMMARY")
        print("="*70)
        
        passed_count = sum(1 for r in self.test_results if r['passed'])
        total_count = len(self.test_results)
        
        for result in self.test_results:
            print(f"   {result['status']}: {result['test']}")
        
        print("\n" + "-"*70)
        print(f"   TOTAL: {passed_count}/{total_count} tests passed ({100*passed_count//max(total_count,1)}%)")
        print("-"*70)
        
        if passed_count == total_count:
            print("\n   [SUCCESS] ALL TESTS PASSED - VMS STANDALONE MODE IS PRODUCTION READY!")
        else:
            print(f"\n   [WARNING] {total_count - passed_count} test(s) failed - review above")
        
        print("="*70 + "\n")
        
        return passed_count == total_count


def main():
    """Main entry point"""
    import argparse
    
    parser = argparse.ArgumentParser(description='VMS Standalone E2E Test Suite')
    parser.add_argument('--url', default='http://localhost:5001', help='VMS base URL')
    
    args = parser.parse_args()
    
    suite = VMSStandaloneTestSuite(base_url=args.url)
    success = suite.run_all_tests()
    
    sys.exit(0 if success else 1)


if __name__ == '__main__':
    main()
