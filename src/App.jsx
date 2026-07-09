import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthProvider';
import NavBar from './components/NavBar';
import HomePage from './pages/HomePage';
import EventDetailPage from './pages/EventDetailPage';
import PostEventPage from './pages/PostEventPage';
import ProfilePage from './pages/ProfilePage';
import MessagesPage from './pages/MessagesPage';

function App() {
  return (
    <AuthProvider>
      <Router>
        <div className="app-container">
          <NavBar />
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/event/:id" element={<EventDetailPage />} />
            <Route path="/post-event" element={<PostEventPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/messages" element={<MessagesPage />} />
          </Routes>
        </div>
      </Router>
    </AuthProvider>
  );
}

export default App;
