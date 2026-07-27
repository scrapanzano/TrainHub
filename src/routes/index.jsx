import { createBrowserRouter, Navigate } from 'react-router'
import AppLayout from '../layouts/AppLayout.jsx'
import PublicLayout from '../layouts/PublicLayout.jsx'
import Placeholder from '../components/Placeholder.jsx'
import { memberNav, professionalNav } from './navItems.js'

// Every screen starts as a placeholder; phases 1-4 replace them one by one.
const screen = (name) => ({ element: <Placeholder name={name} /> })

const router = createBrowserRouter([
  {
    element: <PublicLayout />,
    children: [
      { path: '/login', ...screen('Login') },
      { path: '/forgot-password', ...screen('Forgot Password') },
      { path: '/reset-password', ...screen('Reset Password') },
    ],
  },

  {
    path: '/m',
    element: <AppLayout navItems={memberNav} profileHref="/m/profile" requiredRole="member" />,
    children: [
      { index: true, ...screen('Home') },

      { path: 'workout', ...screen('Workout Plan') },
      { path: 'workout/session/:sessionId', ...screen('Session Detail') },
      { path: 'workout/session/:sessionId/live', ...screen('Live Session') },
      { path: 'workout/session/:sessionId/summary', ...screen('Session Summary') },
      { path: 'workout/exercise/:exerciseId', ...screen('Exercise Details') },
      { path: 'workout/builder', ...screen('Workout Builder') },

      { path: 'nutrition', ...screen('Nutrition') },
      { path: 'nutrition/meal/:mealId', ...screen('Meal Details') },

      { path: 'trainer', ...screen('My Trainer') },
      { path: 'trainer/browse', ...screen('Choose a Professional') },
      { path: 'trainer/appointments', ...screen('My Appointments') },
      { path: 'trainer/chat', ...screen('Chat') },

      { path: 'profile', ...screen('Profile') },
      { path: 'profile/badge', ...screen('Access Badge') },
      { path: 'profile/subscription', ...screen('Subscription') },
      { path: 'profile/rewards', ...screen('Rewards') },
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
