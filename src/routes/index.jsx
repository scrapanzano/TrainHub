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

      { path: 'nutrition', ...screen('Nutrition') },
      { path: 'nutrition/meal/:mealId', ...screen('Meal Details') },

      { path: 'trainer', ...screen('My Trainer') },
      { path: 'trainer/browse', ...screen('Choose a Professional') },
      { path: 'trainer/appointments', ...screen('My Appointments') },
      { path: 'trainer/chat', ...screen('Chat') },

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
      { index: true, ...screen("Today's Agenda") },

      { path: 'clients', ...screen('Clients') },
      { path: 'clients/:clientId', ...screen('Client Detail') },
      { path: 'clients/:clientId/workout', ...screen('Assign Workout') },
      { path: 'clients/:clientId/nutrition', ...screen('Nutrition Plan') },
      { path: 'clients/:clientId/progress', ...screen('Progress Tracking') },

      { path: 'calendar', ...screen('Calendar') },
      // Listed literal-before-parameter for readability only. React Router
      // ranks branches by segment specificity, not declaration order, so a
      // static segment already outranks `:appointmentId` either way.
      { path: 'calendar/availability', ...screen('Availability') },
      { path: 'calendar/:appointmentId', ...screen('Appointment Detail') },

      { path: 'chat', ...screen('Chat') },
      { path: 'chat/:threadId', ...screen('Thread') },

      { path: 'scan', ...screen('Scan Access Badge') },

      { path: 'profile', ...screen('Profile') },
      { path: 'profile/settings', ...screen('Settings') },
    ],
  },

  { path: '/', element: <Navigate to="/m" replace /> },
  { path: '*', element: <Navigate to="/m" replace /> },
])

export default router
