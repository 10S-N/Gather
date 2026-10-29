import { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthProvider';
import { AuthModalProvider } from './contexts/AuthModalProvider';
import NavBar from './components/NavBar';
import PreferencesOnboarding from './components/PreferencesOnboarding';
import HomePage from './pages/HomePage';
import EventDetailPage from './pages/EventDetailPage';
import PostEventPage from './pages/PostEventPage';
import ProfilePage from './pages/ProfilePage';
import RecommendedPage from './pages/RecommendedPage';
import MessagesPage from './pages/MessagesPage';

// The admin dashboard drags the ingestion catalog along with it, so it stays
// out of the main bundle and only loads for people who open /admin/sync.
const AdminSyncPage = lazy(() => import('./pages/AdminSyncPage'));

function App() {
  return (
    <AuthProvider>
      <Router>
        <AuthModalProvider>
          <div className="app-container">
            <NavBar />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/recommended" element={<RecommendedPage />} />
                <Route path="/event/:id" element={<EventDetailPage />} />
                <Route path="/post-event" element={<PostEventPage />} />
                <Route path="/profile" element={<ProfilePage />} />
                <Route path="/messages" element={<MessagesPage />} />
                <Route
                  path="/admin/sync"
                  element={
                    <Suspense fallback={<div className="feed" aria-busy="true" />}>
                      <AdminSyncPage />
                    </Suspense>
                  }
                />
              </Routes>
            </div>
            <PreferencesOnboarding />

            <footer className="site-footer">
              <div className="shell site-footer__inner">
                <div>
                  <span className="nav__brand">
                    GATHER<span className="nav__dot">.</span>
                  </span>
                  <p>Hyper-local happenings, powered by neighbors — not algorithms.</p>
                </div>
                <div className="site-footer__links">
                  <Link to="/">Browse events</Link>
                  <Link to="/post-event">Post an event</Link>
                  <Link to="/profile">Your profile</Link>
                </div>
              </div>
            </footer>
          </div>
        </AuthModalProvider>
      </Router>
    </AuthProvider>
  );
}

export default App;
