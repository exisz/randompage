import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import './index.css';
import Discover from './pages/Discover';
import Bookmarks from './pages/Bookmarks';
import History from './pages/History';
import Settings from './pages/Settings';
import Today from './pages/Today';
import BookSource from './pages/BookSource';
import SignIn from './pages/SignIn';
import Callback from './pages/Callback';
import Landing from './pages/Landing';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/discover" element={<Discover />} />
        <Route path="/bookmarks" element={<Bookmarks />} />
        <Route path="/history" element={<History />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/today" element={<Today />} />
        <Route path="/source" element={<BookSource />} />
        <Route path="/signin" element={<SignIn />} />
        <Route path="/callback" element={<Callback />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
