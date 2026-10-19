import { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/useAuth';
import { useAuthModal } from '../contexts/useAuthModal';
import { isSyncAdmin } from '../utils/admin';

const navClass = ({ isActive }) => `nav__link${isActive ? ' is-active' : ''}`;

function initialsOf(name) {
  return (name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

function NavBar() {
  const { user, signOut } = useAuth();
  const { openLogin, openSignup } = useAuthModal();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  const closeMenu = () => setMenuOpen(false);

  const handleSignOut = async () => {
    await signOut();
    closeMenu();
    navigate('/');
  };

  const handleLogin = () => {
    closeMenu();
    openLogin();
  };

  const handleSignup = () => {
    closeMenu();
    openSignup();
  };

  const displayName = user?.displayName || user?.email?.split('@')[0] || 'You';
  const firstName = displayName.split(' ')[0];
  const showAdmin = isSyncAdmin(user);

  return (
    <nav className="nav">
      <div className="nav__inner">
        <Link to="/" className="nav__brand" onClick={closeMenu}>
          GATHER<span className="nav__dot">.</span>
        </Link>

        <div className="nav__links">
          <NavLink to="/" end className={navClass}>
            Events
          </NavLink>
          <NavLink to="/messages" className={navClass}>
            Messages
          </NavLink>
          <NavLink to="/profile" className={navClass}>
            Profile
          </NavLink>
          {showAdmin && (
            <NavLink to="/admin/sync" className={navClass}>
              Sync
            </NavLink>
          )}
        </div>

        <div className="nav__spacer" />

        <div className="nav__actions">
          {user ? (
            <>
              <Link to="/post-event" className="btn btn--primary btn--sm nav__cta" onClick={closeMenu}>
                + Post event
              </Link>
              <Link to="/profile" className="nav__user" onClick={closeMenu} title={user.email || displayName}>
                {user.photoURL ? (
                  <img className="nav__avatar" src={user.photoURL} alt="" referrerPolicy="no-referrer" />
                ) : (
                  <span className="nav__avatar" aria-hidden="true">
                    {initialsOf(displayName)}
                  </span>
                )}
                <span className="nav__user-name">Hi, {firstName}</span>
              </Link>
              <button type="button" className="nav__icon-btn" onClick={handleSignOut}>
                Log out
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn btn--ghost btn--sm nav__login" onClick={handleLogin}>
                Log in
              </button>
              <button type="button" className="btn btn--primary btn--sm" onClick={handleSignup}>
                Sign up
              </button>
            </>
          )}

          <button
            type="button"
            className="nav__menu-btn"
            aria-expanded={menuOpen}
            aria-controls="nav-mobile"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span aria-hidden="true">{menuOpen ? '✕' : '☰'}</span>
          </button>
        </div>
      </div>

      {menuOpen && (
        <div className="nav__mobile" id="nav-mobile">
          <NavLink to="/" end className={navClass} onClick={closeMenu}>
            Events
          </NavLink>
          <NavLink to="/messages" className={navClass} onClick={closeMenu}>
            Messages
          </NavLink>
          <NavLink to="/profile" className={navClass} onClick={closeMenu}>
            Profile
          </NavLink>
          {showAdmin && (
            <NavLink to="/admin/sync" className={navClass} onClick={closeMenu}>
              Sync
            </NavLink>
          )}

          <div className="nav__mobile-actions">
            {user ? (
              <>
                <Link to="/post-event" className="btn btn--primary btn--sm" onClick={closeMenu}>
                  + Post event
                </Link>
                <button type="button" className="nav__icon-btn" onClick={handleSignOut}>
                  Log out
                </button>
              </>
            ) : (
              <>
                <button type="button" className="btn btn--ghost btn--sm" onClick={handleLogin}>
                  Log in
                </button>
                <button type="button" className="btn btn--primary btn--sm" onClick={handleSignup}>
                  Sign up
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </nav>
  );
}

export default NavBar;
