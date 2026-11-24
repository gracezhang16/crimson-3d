"""Tests for create_admin.py (milestone S2). We test its two functions directly;
main() only adds the command-line argument and the getpass() prompts."""

from werkzeug.security import check_password_hash, generate_password_hash

from create_admin import create_admin, promote_to_admin
from helpers import db


def test_create_admin_makes_an_admin_with_hashed_password():
    user_id = create_admin("admin@example.com", "admin-password")
    user = db.execute("SELECT email, hash, role FROM users WHERE id = ?", user_id)[0]
    assert user["role"] == "admin"
    assert check_password_hash(user["hash"], "admin-password")


def test_promote_turns_a_student_into_an_admin_and_keeps_password():
    original_hash = generate_password_hash("student-password")
    db.execute(
        "INSERT INTO users (email, hash) VALUES ('student@example.com', ?)", original_hash
    )
    assert promote_to_admin("student@example.com") is True
    user = db.execute("SELECT hash, role FROM users WHERE email = 'student@example.com'")[0]
    assert user["role"] == "admin"
    assert user["hash"] == original_hash


def test_promote_reports_missing_account():
    assert promote_to_admin("nobody@example.com") is False
