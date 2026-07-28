# Mobile Application Development
**Header:** Universitu of Brescia,
Information Engineering,
Master Degree in Computer Science

**Project Name:** TrainHub

**Team Members:**

Davide Leone - 723335, d.leone001@studenti.unibs.it,

Andrea Bariselli - 737436, a.bariselli005@studenti.unibs.it

# Table of Contents

1. [Course Assessment](#course-assessment)
2. [Project Assignment](#project-assignment)
3. [Technical Report](#technical-report)
	1. [NODE.JS](#nodejs)
	2. [VISUAL STUDIO CODE EXTENSIONS](#visual-studio-code-extensions)
4. [Enviroment configuration for React](#enviroment-configuration-for-react)
5. [Creation of a starter template (React + PWA)](#creation-of-a-starter-template-react--pwa)
	1. [VITE](#vite)
	2. [VITE + PWA](#vite--pwa)
	3. [VITE.CONFIG.JS](#viteconfigjs)
	4. [SERVICE WORKER](#service-worker)
6. [COMPONENT-BASED-UI](#component-based-ui)
	1. [MUI (MATERIAL UI)](#mui-material-ui)
7. [Essential Technical Requirements for a Progressive Web App (PWA)](#essential-technical-requirements-for-a-progressive-web-app-pwa)


# Course Assessment
The course assessment consists of a **team project.** A team is constituted of **2 or 3 students.**

The project consists of the **desing and implementation of a mobile application** (Progressive Web App - PWA) accompanied by a **technical report** detailing the work.

On the day of the exam (in person), **all team members will present their project using a slide deck** (PowerPoint or a similar tool). **Each team member must be present and actively participate in the presentation.**

After the presentation, **the team will let the lecturer try the mobile application**. Then, during the final part of the exam, the lecturer will pose **questions to the team members about the project’s code and the related course’s topics.** 

**A copy of the PWA code and the technical report must be provided to the lecturer on the day of the exam** (copied from a USB memory stick or shared via a cloud service (e.g., Google Drive, WeTransfer, …). **The technical report does not have to be printed!**

**The marks can differ among the team members (based on their participation in the presentation and the answers to the lecturer’s questions).**

If the project does not reach the minimum passing grade, or if a student
declines the assigned grade, one additional revision and re-presentation
is allowed.

Once the maximum number of attempts is reached, the team or a single
team member will be assigned a new project. 

**Examination dates are arranged by appointment after the end of the course (send an email to the lecturer).**

# Project Assignment

**App Name:** TrainHub

**Description:**

This mobile application is an all-in-one digital hub designed to bridge the gap between gym members and fitness professionals. It streamlines the fitness journey by centralizing customized workout tracking, diet management, appointment booking, and facility access into a single, seamless platform.

**Potential Users:**

* Gym Members (Subscribed Clients): users seeking a structured, interactive and rewarding fitness experience
* Personal Trainers (Admin): professionals needing an efficient tool to manage their clients, schedules and custom plans

# Technical Report
The technical report that must be provided to the lecturer the
day of the examination must document the design and the
development activity.

Some examples are published in ```@technical_report_examples```.

The mandatory elements of the technical report are illustrated as follows:

* **Competitor analysis:** Identify competitors (direct and/or indirect), describe the apps briefly (name, screenshots, and short description), create a dimension comparison table, create a feature comparison table, and identify how/where your app could be competitive

* **Interviews (and Surveys):** Conduct qualitative and quantitative user research through interviews and questionnaires
. The collected information should be grouped and organized (for example, by creating an Affinity Diagram)

* **Personas:** Create at least two personas representing the potential users

* **Scenarios:** Write at least one scenario for each persona you previously created

* **Navigation map:** Create a navigation map (first with sticky notes, then in Figma) to show all screens and how users navigate through the system

* **Paper prototype (wireframes):** Create a paper prototype using wireframe sheets and include the pictures of these wireframes in the technical report

* **Digital prototype (Figma): Create the interactive digital prototype of the app starting from the paper wireframes**

The technical report will be a LaTeX document.

# Enviroment configuration for React
It should already be configured as follows.

## NODE.JS
The **runtime environment** that allows us to run JavaScript outside
of a browser. We use it for managing dependencies, install libraries,
and more.

Download **LTS (long-term support version)** from the website: https://nodejs.org/en

Install it with the default setting options (npm included!).

To verify the installation:

* ```node -v```

* ```npm -v```

## VISUAL STUDIO CODE EXTENSIONS

* **ESLint** (helps in detecting errors and improves code quality enforcing coding rules)

* **Prettier** (automatically formats our code to keep it consistent
and readable)

# Creation of a starter template (React + PWA)
It should already be created as follows.

## VITE
```npm create vite@latest TrainHub --template react```

* ```npm install```

* ```npm run dev```

Open in your browser http://localhost:5173

If the Vite default landing page is there, everything is working
correctly. 

## VITE + PWA
```npm install –D vite-plugin-pwa –legacy-peer-deps```

It should have been created as a React framework, using Javascript and ESLint

## VITE.CONFIG.JS
Edit this file ```@vite.config``` to configure **manifest** of the PWA:

* Name: edited already

* Short name: edited already

* Description: edited already

* Theme color and backgroud color: edited already

* Icons: **TODO**

## SERVICE WORKER
Open ```@src/main.jsx``` and add:

* ```import { registerSW } from 'virtual:pwa-register'```: added already

* ```registerSW({ immediate: true })```: added already

# COMPONENT-BASED-UI

## MUI (MATERIAL UI)
The full documentation is available here: https://mui.com/

```npm install @mui/material @emotion/react @emotion/styled```

# Making your PWA installable on mobile devices (HTTPS Setup)

## NGROK
It should have been already fullfiled.

Create a free account: https://ngrok.com/ (my GitHub Account)

Install Ngrok: ```npm install -g ngrok```

Add the Ngrok auth token: ```ngrok config add-authtoken 3DOp2gfmPlRfNLtAvIZm0SsmbpN_2E9fpRjNZVkYrwxTWZbSv```

# Essential Technical Requirements for a Progressive Web App (PWA)
Beyond the React environment setup and the use of Material UI, the essential technical and architectural aspects your PWA must implement include:

* **Web App Manifest Configuration:** This acts as the "ID card" of the PWA and defines essential application metadata, such as the app name, short name, description, theme colors, and icons. It is the fundamental component that enables installation on the device

* **Service Worker Implementation:** This is a script that runs in the background and is strictly required to cache resources, intercept network requests, and allow the app to work offline or with poor connectivity

* **Installability and HTTPS Connection:** The PWA must be installable on the user's device and run in a stand-alone mode (without the browser UI). The sources explicitly state that to enable the installation feature on mobile devices, **a publicly accessible secure URL (HTTPS) is mandatory**, as browsers block the install feature on standard HTTP

* **Responsive UI Adaptation:** Although you will use Material UI (MUI), the lectures emphasize that "MUI is mobile friendly but not natively responsive". Therefore, it is required to **create and configure a custom theme** (e.g., using ```createTheme``` and ```responsiveFontSizes```) to ensure the user interface correctly adapts to different screen sizes

* **Adherence to Mobile Development Principles:** The development process must follow fundamental rules for the mobile context. This includes **respecting user-entered data** (like auto-saving as the user types to prevent data loss in case of errors), ensuring user tasks take precedence (e.g., not interrupting an ongoing operation or making the user lose focus), and ensuring consistency with standard OS behaviors

Depending on your project's specific scope and approved proposal, the course material also covers several advanced features that you might need to implement to create an "app-like" experience:

* **Multi-page client-side routing** using React Router to manage navigation between different views

* **Data persistence**, either locally (using ```localStorage``` or ```IndexedDB```) or in the cloud using a Backend-as-a-Service like **Supabase** for database management and user authentication

* **Push notifications** implemented via VAPID keys and database tables

* Access to **native device APIs and sensors**, such as the camera or GPS geolocation