"""Blueprint "pages": public and student HTML pages (Grace). Routes: SPEC.md 7.1."""

from flask import Blueprint, flash, redirect, render_template, request, session
from werkzeug.security import check_password_hash, generate_password_hash

from helpers import check_new_account, db, normalize_email

pages = Blueprint("pages", __name__)


@pages.route("/")
def index():
    """List every dorm that has at least one published room type.

    S3 adds the search box and links to each dorm's page.
    """
    dorms = db.execute(
        "SELECT dorms.id, dorms.name, dorms.yard, COUNT(room_types.id) AS type_count "
        "FROM dorms JOIN room_types ON room_types.dorm_id = dorms.id "
        "WHERE room_types.status = 'published' "
        "GROUP BY dorms.id ORDER BY dorms.name"
    )
    return render_template("index.html", dorms=dorms)


@pages.route("/register", methods=["GET", "POST"])
def register():
    """Show the sign-up form, or create a student account and log it in.

    On bad input the form is shown again with the reason and the email still
    filled in (status 400), rather than a separate error page.
    """
    if request.method == "GET":
        return render_template("register.html")

    email = normalize_email(request.form.get("email"))
    error = check_new_account(
        email, request.form.get("password"), request.form.get("confirmation")
    )
    if error:
        return render_template("register.html", error=error, email=email), 400

    # The UNIQUE constraint on users.email is the real duplicate check: cs50.SQL
    # raises ValueError if the email is taken. Checking with a SELECT first
    # could miss two sign-ups arriving at the same moment.
    try:
        user_id = db.execute(
            "INSERT INTO users (email, hash) VALUES (?, ?)",
            email, generate_password_hash(request.form.get("password")),
        )
    except ValueError:
        error = "An account with that email already exists. Try logging in."
        return render_template("register.html", error=error, email=email), 400

    session.clear()
    session["user_id"] = user_id
    flash("Welcome to Crimson3D! You're registered and logged in.")
    return redirect("/")


@pages.route("/login", methods=["GET", "POST"])
def login():
    """Show the login form, or log a user in."""
    if request.method == "GET":
        return render_template("login.html")

    # Forget any previous user before checking the new one (as in CS50 Finance).
    session.clear()

    email = normalize_email(request.form.get("email"))
    password = request.form.get("password") or ""
    rows = db.execute("SELECT id, hash FROM users WHERE email = ?", email)

    # Same message whether the email or the password is wrong, so the form
    # doesn't reveal which emails have accounts.
    if len(rows) != 1 or not check_password_hash(rows[0]["hash"], password):
        error = "Wrong email or password."
        return render_template("login.html", error=error, email=email), 403

    session["user_id"] = rows[0]["id"]
    return redirect("/")


@pages.route("/logout")
def logout():
    """Log the user out and go back to the home page."""
    session.clear()
    return redirect("/")
