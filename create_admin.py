"""Create an admin account, or turn an existing account into an admin.

Usage:
    python create_admin.py you@example.com

Admins are made only here, never through the website (SPEC.md 7.4). If the
email already has an account (for example you registered on the site first),
that account becomes an admin and keeps its password. Otherwise you are asked
for a new password, twice.

getpass() reads the password without showing it on screen, and because it is
typed rather than passed as an argument, it never lands in your shell history.
"""

import sys
from getpass import getpass

from werkzeug.security import generate_password_hash

from helpers import check_new_account, db, normalize_email


def promote_to_admin(email):
    """Make the existing account with this email an admin.

    Returns True if an account was found (even if it was already an admin),
    False if there is no account with that email.
    """
    return db.execute("UPDATE users SET role = 'admin' WHERE email = ?", email) == 1


def create_admin(email, password):
    """Insert a new admin account and return its id. The email must be unused."""
    return db.execute(
        "INSERT INTO users (email, hash, role) VALUES (?, ?, 'admin')",
        email, generate_password_hash(password),
    )


def main():
    """Read the email from the command line, then promote or create."""
    if len(sys.argv) != 2:
        sys.exit("Usage: python create_admin.py you@example.com")
    email = normalize_email(sys.argv[1])

    if promote_to_admin(email):
        print(f"{email} is now an admin. Their password is unchanged.")
        return

    password = getpass("New password for the admin account: ")
    confirmation = getpass("Type it again: ")
    error = check_new_account(email, password, confirmation)
    if error:
        sys.exit(error)
    create_admin(email, password)
    print(f"Created admin account {email}.")


if __name__ == "__main__":
    main()
