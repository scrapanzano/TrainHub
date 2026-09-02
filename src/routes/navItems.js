import HomeIcon from '@mui/icons-material/Home'
import FitnessCenterIcon from '@mui/icons-material/FitnessCenter'
import RestaurantIcon from '@mui/icons-material/Restaurant'
import PersonIcon from '@mui/icons-material/Person'
import PeopleIcon from '@mui/icons-material/People'
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth'
import ChatBubbleIcon from '@mui/icons-material/ChatBubble'

export const memberNav = [
  { to: '/m',           label: 'Home',       icon: HomeIcon },
  { to: '/m/workout',   label: 'Workout',    icon: FitnessCenterIcon },
  { to: '/m/nutrition', label: 'Nutrition',  icon: RestaurantIcon },
  { to: '/m/trainer',   label: 'My Trainer', icon: PersonIcon },
]

export const professionalNav = [
  { to: '/p',          label: 'Home',     icon: HomeIcon },
  { to: '/p/clients',  label: 'Clients',  icon: PeopleIcon },
  { to: '/p/calendar', label: 'Calendar', icon: CalendarMonthIcon },
  { to: '/p/chat',     label: 'Chat',     icon: ChatBubbleIcon },
]
