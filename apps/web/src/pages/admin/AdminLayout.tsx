import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LogOut, Settings } from 'lucide-react';
import { Link, Navigate, Outlet, useNavigate } from 'react-router';
import { BrandMark, FullScreenSpinner } from '../../components/ui.tsx';
import { api } from '../../lib/api.ts';
import { authStatus } from '../../lib/passkey.ts';
import './admin.css';

export function useRequireHost() {
  const auth = useQuery({ queryKey: ['auth'], queryFn: authStatus });
  return { loading: auth.isLoading, loggedIn: !!auth.data?.loggedIn };
}

export default function AdminLayout() {
  const { loading, loggedIn } = useRequireHost();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  if (loading) return <FullScreenSpinner />;
  if (!loggedIn) return <Navigate to="/login" replace />;

  const logout = async () => {
    await api('/api/auth/logout', { body: {} });
    queryClient.clear();
    navigate('/login');
  };

  return (
    <div>
      <header className="topbar">
        <Link to="/admin" className="brand">
          <BrandMark /> TakePart
        </Link>
        <span className="grow" />
        <Link to="/admin/einstellungen" className="icon-btn" aria-label="Einstellungen" title="Einstellungen">
          <Settings />
        </Link>
        <button className="icon-btn" onClick={logout} aria-label="Abmelden" title="Abmelden">
          <LogOut />
        </button>
      </header>
      <Outlet />
    </div>
  );
}
