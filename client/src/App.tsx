import { useEffect, useState } from "react";
import Login from "./Login";
import { apiRequest } from "./lib/api";
import "./App.css";

type FormSummary = {
  id: string;
  title: string;
  description: string | null;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  updatedAt: string;
  _count?: {
    submissions: number;
  };
};

type User = {
  id: string;
  email: string;
  name?: string | null;
};

type FormsResponse = {
  status: string;
  count: number;
  forms: FormSummary[];
};

type AuthResponse = {
  status: string;
  user: User;
};
const navigationItems = [
  { label: "Overview", icon: "◫" },
  { label: "My forms", icon: "▤" },
  { label: "Submissions", icon: "↙" },
] as const;

function App() {
  const [activeNav, setActiveNav] = useState<string>("Overview");
  const [forms, setForms] = useState<FormSummary[]>([]);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [formTitle, setFormTitle] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [formsLoading, setFormsLoading] = useState(false);
  const [apiError, setApiError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function restoreSession() {
      try {
        const result = await apiRequest<AuthResponse>("/auth/me");

        if (!cancelled) {
          setUser(result.user);
        }
      } catch {
        if (!cancelled) {
          setUser(null);
        }
      } finally {
        if (!cancelled) {
          setAuthLoading(false);
        }
      }
    }

    void restoreSession();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!user) return;

    let cancelled = false;

    async function loadForms() {
      setFormsLoading(true);
      setApiError("");

      try {
        const result = await apiRequest<FormsResponse>("/forms");

        if (!cancelled) {
          setForms(result.forms);
        }
      } catch (error) {
        if (!cancelled) {
          setApiError(
            error instanceof Error ? error.message : "Unable to load forms.",
          );
        }
      } finally {
        if (!cancelled) {
          setFormsLoading(false);
        }
      }
    }

    void loadForms();

    return () => {
      cancelled = true;
    };
  }, [user]);

  function handleLogin(loggedInUser: User) {
    setUser(loggedInUser);
  }

  async function handleLogout() {
    try {
      await apiRequest<{ status: string }>("/auth/logout", {
        method: "POST",
      });
    } finally {
      setUser(null);
      setForms([]);
      setApiError("");
      setActiveNav("Overview");
    }
  }

  async function handleCreateForm() {
    const title = formTitle.trim();

    if (!title) return;

    setApiError("");

    try {
      const result = await apiRequest<{
        status: string;
        message: string;
        form: FormSummary;
      }>("/forms", {
        method: "POST",
        body: JSON.stringify({ title }),
      });

      setForms((currentForms) => [
        result.form,
        ...currentForms.filter((form) => form.id !== result.form.id),
      ]);

      setFormTitle("");
      setShowCreateForm(false);
      setActiveNav("My forms");
    } catch (error) {
      setApiError(
        error instanceof Error ? error.message : "Unable to create your form.",
      );
    }
  }

  const visibleForms =
    activeNav === "Overview" || activeNav === "My forms" ? forms : [];

  if (authLoading) {
    return <main className="login-page">Checking your session...</main>;
  }

  if (!user) {
    return <Login onLogin={handleLogin} />;
  }
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" aria-label="FormPilot home">
          <span className="brand-mark">F</span>
          <span>FormPilot</span>
        </a>

        <div className="workspace-label">WORKSPACE</div>

        <nav className="sidebar-nav" aria-label="Main navigation">
          {navigationItems.map((item) => (
            <button
              key={item.label}
              type="button"
              className={`nav-item ${activeNav === item.label ? "active" : ""}`}
              onClick={() => setActiveNav(item.label)}
            >
              <span className="nav-icon" aria-hidden="true">
                {item.icon}
              </span>
              {item.label}
              {item.label === "My forms" && forms.length > 0 && (
                <span className="nav-count">{forms.length}</span>
              )}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="plan-card">
            <span className="plan-label">YOUR WORKSPACE</span>
            <strong>Free plan</strong>
            <p>Your FormPilot workspace is ready to grow.</p>
          </div>

          <div className="profile">
            <div className="avatar">DV</div>
            <div className="profile-info">
              <strong>Workspace owner</strong>
              <span>Local preview</span>
            </div>
            <span className="profile-menu" aria-hidden="true">
              ···
            </span>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <span>/</span> {activeNav}
          </div>

          <div className="topbar-actions">
            <span className="preview-badge">
              <span className="status-dot" />
              Development preview
            </span>

            <button
              type="button"
              className="text-button"
              onClick={() => void handleLogout()}
            >
              Sign out
            </button>
          </div>
        </header>

        <div className="page-content">
          <section className="welcome-section">
            <div>
              <p className="eyebrow">YOUR WORKSPACE</p>
              <h1>
                {activeNav === "Submissions"
                  ? "Submissions"
                  : activeNav === "My forms"
                    ? "My forms"
                    : "Good things start with a form."}
              </h1>
              <p className="page-description">
                {activeNav === "Submissions"
                  ? "Your form responses will be available here once submissions are connected."
                  : "Create forms, collect responses, and turn feedback into insights."}
              </p>
            </div>

            <button
              className="primary-button"
              type="button"
              onClick={() => setShowCreateForm(true)}
            >
              <span aria-hidden="true">+</span>
              Create form
            </button>
          </section>

          <section className="stats-grid" aria-label="Workspace statistics">
            <article className="stat-card">
              <div className="stat-heading">
                <span>All forms</span>
                <span className="stat-icon">▤</span>
              </div>
              <strong className="stat-value">{forms.length}</strong>
              <span className="stat-caption">Forms in your workspace</span>
            </article>

            <article className="stat-card">
              <div className="stat-heading">
                <span>Published</span>
                <span className="stat-icon green">↗</span>
              </div>
              <strong className="stat-value">0</strong>
              <span className="stat-caption">Ready to collect responses</span>
            </article>

            <article className="stat-card">
              <div className="stat-heading">
                <span>Responses</span>
                <span className="stat-icon coral">☷</span>
              </div>
              <strong className="stat-value">0</strong>
              <span className="stat-caption">Responses collected</span>
            </article>
          </section>

          <section className="forms-section">
            {apiError && (
              <p className="api-error" role="alert">
                {apiError}
              </p>
            )}
            <div className="section-heading">
              <div>
                <h2>
                  {activeNav === "Submissions"
                    ? "Response centre"
                    : "Your forms"}
                </h2>
                <p>
                  {activeNav === "Submissions"
                    ? "Review responses after your forms go live."
                    : "Manage your forms from one place."}
                </p>
              </div>

              {forms.length > 0 && activeNav !== "Submissions" && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setActiveNav("My forms")}
                >
                  View all forms →
                </button>
              )}
            </div>

            {activeNav === "Submissions" ? (
              <div className="empty-state">
                <div className="empty-icon">☷</div>
                <h3>No responses yet</h3>
                <p>
                  Once your forms are published and people submit them, their
                  responses will appear here.
                </p>
              </div>
            ) : formsLoading ? (
              <div className="empty-state">
                <h3>Loading your forms...</h3>
                <p>Please wait while we retrieve your saved forms.</p>
              </div>
            ) : visibleForms.length === 0 ? (
              <div className="empty-state">
                <div className="empty-illustration">
                  <div className="paper paper-back" />
                  <div className="paper paper-front">
                    <span />
                    <span />
                    <span />
                    <span className="paper-check">✓</span>
                  </div>
                  <div className="floating-plus">+</div>
                </div>

                <h3>Your first form is waiting</h3>
                <p>
                  Start with a feedback form, a survey, or a registration form.
                  You can customise it as you go.
                </p>

                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setShowCreateForm(true)}
                >
                  + Create your first form
                </button>
              </div>
            ) : (
              <div className="forms-list">
                {visibleForms.map((form) => (
                  <article className="form-row" key={form.id}>
                    <div className="form-file-icon">▤</div>
                    <div className="form-details">
                      <strong>{form.title}</strong>
                      <span>Updated {form.updatedAt}</span>
                    </div>
                    <span className="draft-badge">
                      {form.status === "DRAFT"
                        ? "Draft"
                        : form.status === "PUBLISHED"
                          ? "Published"
                          : "Archived"}
                    </span>
                    <button
                      type="button"
                      className="row-menu"
                      aria-label={`Options for ${form.title}`}
                      onClick={() => setFormTitle(form.title)}
                    >
                      ···
                    </button>
                  </article>
                ))}
              </div>
            )}
          </section>

          <footer className="page-footer">
            <span>FormPilot</span>
            <span>Build better forms. Make better decisions.</span>
          </footer>
        </div>
      </main>

      {showCreateForm && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setShowCreateForm(false);
            }
          }}
        >
          <section
            className="create-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-form-title"
          >
            <button
              type="button"
              className="modal-close"
              aria-label="Close dialog"
              onClick={() => setShowCreateForm(false)}
            >
              ×
            </button>

            <p className="eyebrow">GET STARTED</p>
            <h2 id="create-form-title">Create a new form</h2>
            <p className="modal-description">
              Give your form a name. You can add questions in the next step.
            </p>

            <form
              onSubmit={(event) => {
                event.preventDefault();
                void handleCreateForm();
              }}
            >
              <label htmlFor="form-title">Form name</label>
              <input
                id="form-title"
                autoFocus
                value={formTitle}
                onChange={(event) => setFormTitle(event.target.value)}
                placeholder="e.g. Customer feedback"
                maxLength={100}
                required
              />

              <div className="modal-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setShowCreateForm(false)}
                >
                  Cancel
                </button>
                <button className="primary-button" type="submit">
                  Create draft
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}

export default App;
