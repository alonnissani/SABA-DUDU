import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router';
import { AppStateProvider, ToastProvider, useApp } from './state';
import { Shell } from './components/Shell';
import { Landing } from './screens/Landing';
import { InviteScreen, LoginScreen, ResetScreen, SetupScreen } from './screens/AuthScreens';
import { HomeScreen } from './screens/Home';
import { CategoryScreen } from './screens/Category';
import { AddItemScreen } from './screens/AddItem';
import { ItemScreen } from './screens/ItemScreen';
import { SearchScreen } from './screens/Search';
import { SettingsScreen } from './screens/settings/Settings';

function RequireAuth() {
  const { user, status } = useApp();
  const loc = useLocation();
  if (!user) {
    if (status?.setupRequired) return <Navigate to="/setup" replace />;
    return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  }
  return <Outlet />;
}

export function App() {
  return (
    <ToastProvider>
      <AppStateProvider>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<LoginScreen />} />
          <Route path="/setup" element={<SetupScreen />} />
          <Route path="/invite/:token" element={<InviteScreen />} />
          <Route path="/reset/:token" element={<ResetScreen />} />
          <Route element={<RequireAuth />}>
            <Route element={<Shell />}>
              <Route path="/home" element={<HomeScreen />} />
              <Route path="/c/:kind" element={<CategoryScreen />} />
              <Route path="/c/:kind/new" element={<AddItemScreen />} />
              <Route path="/item/:id" element={<ItemScreen />} />
              <Route path="/search" element={<SearchScreen />} />
              <Route path="/settings/*" element={<SettingsScreen />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppStateProvider>
    </ToastProvider>
  );
}
