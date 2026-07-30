import { createBrowserRouter, Navigate } from 'react-router'
import AppLayout from '../layouts/AppLayout.jsx'
import PublicLayout from '../layouts/PublicLayout.jsx'
import Placeholder from '../components/Placeholder.jsx'
import LoginScreen from '../features/auth/LoginScreen.jsx'
import ForgotPasswordScreen from '../features/auth/ForgotPasswordScreen.jsx'
import ResetPasswordScreen from '../features/auth/ResetPasswordScreen.jsx'
import { memberNav, professionalNav } from './navItems.js'

// Every screen starts as a placeholder; phases 1-4 replace them one by one.
const screen = (name) => ({ element: <Placeholder name={name} /> })

const router = createBrowserRouter([
  {
    element: <PublicLayout />,
    children: [
      { path: '/login', element: <LoginScreen /> },
      { path: '/forgot-password', element: <ForgotPasswordScreen /> },
      { path: '/reset-password', element: <ResetPasswordScreen /> },
    ],
  },

  {
    path: '/m',
    element: <AppLayout navItems={memberNav} profileHref="/m/profile" requiredRole="member" />,
    children: [
      {
        index: true,
        lazy: async () => ({ Component: (await import('../features/home/MemberHomeScreen.jsx')).default }),
      },

      {
        path: 'workout',
        lazy: async () => ({ Component: (await import('../features/workout/WorkoutPlanScreen.jsx')).default }),
      },
      {
        path: 'workout/session/:sessionId',
        lazy: async () => ({ Component: (await import('../features/workout/SessionDetailScreen.jsx')).default }),
      },
      {
        path: 'workout/session/:sessionId/live',
        lazy: async () => ({
          Component: (await import('../features/workout/LiveSessionScreen.jsx')).default,
        }),
      },
      {
        path: 'workout/session/:sessionId/summary',
        lazy: async () => ({
          Component: (await import('../features/workout/SessionSummaryScreen.jsx')).default,
        }),
      },
      // The parameter is a `session_exercises.id`, not an `exercises.id`: this
      // screen shows the prescription (sets, reps, rest), which only exists on
      // the join row.  The path segment is unchanged.
      {
        path: 'workout/exercise/:sessionExerciseId',
        lazy: async () => ({ Component: (await import('../features/workout/ExerciseDetailScreen.jsx')).default }),
      },
      {
        path: 'workout/builder',
        lazy: async () => ({
          Component: (await import('../features/workout/WorkoutBuilderScreen.jsx')).default,
        }),
      },

      {
        path: 'nutrition',
        lazy: async () => ({
          Component: (await import('../features/nutrition/MemberNutritionScreen.jsx')).default,
        }),
      },
      {
        path: 'nutrition/meal/:mealId',
        lazy: async () => ({
          Component: (await import('../features/nutrition/MealDetailScreen.jsx')).default,
        }),
      },

      {
        path: 'trainer',
        lazy: async () => ({
          Component: (await import('../features/trainer/MyTrainerScreen.jsx')).default,
        }),
      },
      {
        path: 'trainer/browse',
        lazy: async () => ({
          Component: (await import('../features/trainer/BrowseTrainersScreen.jsx')).default,
        }),
      },
      { path: 'trainer/appointments', ...screen('My Appointments') },
      {
        path: 'trainer/chat',
        lazy: async () => ({ Component: (await import('../features/chat/ThreadScreen.jsx')).default }),
      },

      { path: 'profile', ...screen('Profile') },
      { path: 'profile/badge', ...screen('Access Badge') },
      { path: 'profile/subscription', ...screen('Subscription') },
      {
        path: 'profile/rewards',
        lazy: async () => ({
          Component: (await import('../features/rewards/RewardsScreen.jsx')).default,
        }),
      },
      { path: 'profile/settings', ...screen('Settings') },
    ],
  },

  {
    path: '/p',
    element: (
      <AppLayout navItems={professionalNav} profileHref="/p/profile" requiredRole="professional" />
    ),
    children: [
      {
        index: true,
        lazy: async () => ({
          Component: (await import('../features/agenda/ProfessionalHomeScreen.jsx')).default,
        }),
      },

      {
        path: 'clients',
        lazy: async () => ({
          Component: (await import('../features/clients/ClientsScreen.jsx')).default,
        }),
      },
      {
        path: 'clients/:clientId',
        lazy: async () => ({
          Component: (await import('../features/clients/ClientDetailScreen.jsx')).default,
        }),
      },
      {
        path: 'clients/:clientId/workout',
        lazy: async () => ({
          Component: (await import('../features/clients/ClientWorkoutScreen.jsx')).default,
        }),
      },
      {
        path: 'clients/:clientId/nutrition',
        lazy: async () => ({
          Component: (await import('../features/nutrition/NutritionPlanEditorScreen.jsx')).default,
        }),
      },
      {
        path: 'clients/:clientId/progress',
        lazy: async () => ({
          Component: (await import('../features/progress/ClientProgressScreen.jsx')).default,
        }),
      },

      {
        path: 'calendar',
        lazy: async () => ({
          Component: (await import('../features/calendar/CalendarScreen.jsx')).default,
        }),
      },
      // Listed literal-before-parameter for readability only. React Router
      // ranks branches by segment specificity, not declaration order, so a
      // static segment already outranks `:appointmentId` either way.
      {
        path: 'calendar/availability',
        lazy: async () => ({
          Component: (await import('../features/calendar/AvailabilityScreen.jsx')).default,
        }),
      },
      {
        path: 'calendar/:appointmentId',
        lazy: async () => ({
          Component: (await import('../features/calendar/AppointmentDetailScreen.jsx')).default,
        }),
      },

      {
        path: 'chat',
        lazy: async () => ({
          Component: (await import('../features/chat/ThreadListScreen.jsx')).default,
        }),
      },
      {
        path: 'chat/:threadId',
        lazy: async () => ({ Component: (await import('../features/chat/ThreadScreen.jsx')).default }),
      },

      { path: 'scan', ...screen('Scan Access Badge') },

      { path: 'profile', ...screen('Profile') },
      { path: 'profile/settings', ...screen('Settings') },
    ],
  },

  { path: '/', element: <Navigate to="/m" replace /> },
  { path: '*', element: <Navigate to="/m" replace /> },
])

export default router
