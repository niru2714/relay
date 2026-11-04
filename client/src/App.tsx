import { Link, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { EmptyState } from './components/ui/primitives';
import { Dashboard } from './pages/Dashboard';
import { Jobs } from './pages/Jobs';
import { JobDetailPage } from './pages/JobDetail';
import { ManualQueue } from './pages/ManualQueue';
import { Riders } from './pages/Riders';

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="jobs" element={<Jobs />} />
        <Route path="jobs/:id" element={<JobDetailPage />} />
        <Route path="queue" element={<ManualQueue />} />
        <Route path="riders" element={<Riders />} />
        <Route
          path="*"
          element={
            <EmptyState title="Page not found">
              That page does not exist.{' '}
              <Link to="/" className="font-medium text-indigo-600 hover:underline">
                Back to the dashboard
              </Link>
            </EmptyState>
          }
        />
      </Route>
    </Routes>
  );
}
