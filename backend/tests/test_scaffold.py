"""Scaffold endpoint smoke tests for FastAPI defaults."""
import os
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://crux-escalations.preview.emergentagent.com').rstrip('/')


def test_root_hello_world():
    r = requests.get(f"{BASE_URL}/api/")
    assert r.status_code == 200
    assert r.json() == {"message": "Hello World"}


def test_create_status_check():
    payload = {"client_name": "TEST_scaffold_client"}
    r = requests.post(f"{BASE_URL}/api/status", json=payload)
    assert r.status_code == 200
    data = r.json()
    assert data["client_name"] == "TEST_scaffold_client"
    assert "id" in data
    assert "timestamp" in data


def test_get_status_checks_contains_created():
    r = requests.get(f"{BASE_URL}/api/status")
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    assert any(d.get("client_name") == "TEST_scaffold_client" for d in data)
    # ensure no _id leak
    for d in data:
        assert "_id" not in d
