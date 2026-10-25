import unittest
from unittest.mock import patch

import app as checker


class EmailCheckerTests(unittest.TestCase):
    def setUp(self):
        checker.app.config["TESTING"] = True
        self.client = checker.app.test_client()

    def test_homepage_renders(self):
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        self.assertIn(b"Check email addresses", response.data)
        self.assertIn(b"Unknown", response.data)

    def test_health_endpoint(self):
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["status"], "ok")

    def test_rejects_empty_input(self):
        response = self.client.post("/api/check", json={"emails": "  "})
        self.assertEqual(response.status_code, 400)

    def test_rejects_more_than_100_addresses(self):
        response = self.client.post("/api/check", json={"emails": "\n".join(f"bad-{i}" for i in range(101))})
        self.assertEqual(response.status_code, 400)

    @patch.object(checker, "check_domain", return_value={"kind": "delivered", "detail": "Mocked domain signal."})
    def test_counts_results_and_keeps_duplicates(self, _mock_domain):
        response = self.client.post("/api/check", json={"emails": "valid@gmail.com\nvalid@gmail.com\ninvalid-address"})
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertEqual(data["counts"]["total"], 3)
        self.assertEqual(data["counts"]["delivered"], 2)
        self.assertEqual(data["counts"]["bounce"], 1)
        self.assertEqual(data["counts"]["duplicate_addresses"], 1)
        self.assertEqual(len(data["results"]), 3)

    @patch.object(checker, "check_domain", return_value={"kind": "unknown", "detail": "Mocked DNS timeout."})
    def test_unknown_dns_result_is_reported(self, _mock_domain):
        response = self.client.post("/api/check", json={"emails": "person@gmail.com"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["results"][0]["status"], "Unknown")


if __name__ == "__main__":
    unittest.main()
