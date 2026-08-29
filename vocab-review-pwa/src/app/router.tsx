import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { HomePage } from '../pages/HomePage';
import { OnboardingPage } from '../pages/OnboardingPage';
import { DiagnosisSetupPage } from '../pages/DiagnosisSetupPage';
import { StudyPage } from '../pages/StudyPage';
import { SessionSummaryPage } from '../pages/SessionSummaryPage';
import { WordListPage } from '../pages/WordListPage';
import { WordDetailPage } from '../pages/WordDetailPage';
import { StatisticsPage } from '../pages/StatisticsPage';
import { SettingsPage } from '../pages/SettingsPage';
import { BottomNav } from '../components/BottomNav';

export function AppRoutes() {
  const location = useLocation();
  const hideNav = location.pathname.startsWith('/study');
  return (
    <div className="app-shell">
      <main className="app-main">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/onboarding" element={<OnboardingPage />} />
          <Route path="/diagnosis" element={<DiagnosisSetupPage />} />
          <Route path="/study" element={<StudyPage />} />
          <Route path="/summary/:sessionId" element={<SessionSummaryPage />} />
          <Route path="/words" element={<WordListPage />} />
          <Route path="/words/:id" element={<WordDetailPage />} />
          <Route path="/stats" element={<StatisticsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      {!hideNav && <BottomNav />}
    </div>
  );
}
