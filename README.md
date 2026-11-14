<p align="center">
  <img src=".github/readme/hero.svg" alt="Hora. School, calendar, tasks and the way there. One app, on your device." width="100%">
</p>

<p align="center">
  <a href="https://hora-app.netlify.app/download"><img src="https://img.shields.io/badge/version-0.6.0_beta-2E3A2F?style=flat-square&labelColor=86A36F" alt="Version 0.6.0, beta"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-PolyForm_Noncommercial_or_commercial-2E3A2F?style=flat-square&labelColor=86A36F" alt="License: PolyForm Noncommercial or commercial"></a>
  <img src="https://img.shields.io/badge/platforms-macOS_·_Windows_·_Linux_·_Android_·_Web-2E3A2F?style=flat-square&labelColor=86A36F" alt="Platforms: macOS, Windows, Linux, Android, Web">
  <img src="https://img.shields.io/badge/account-optional-2E3A2F?style=flat-square&labelColor=C96F4F" alt="Account optional">
</p>

<p align="center">
  <a href="#download">Download</a> ·
  <a href="#what-is-inside">What is inside</a> ·
  <a href="#privacy">Privacy</a> ·
  <a href="#license">License</a>
</p>

# Hora

**One app for the school day.** Hora brings timetable, tasks, calendar, mail, transit and a local assistant together, and keeps it on your own device. An account for sync is optional, and there is no telemetry.

I built Hora because I was tired of switching between separate apps for school, calendar, transit and tasks. Instead of stitching together tools that don't talk to each other, I wanted one system that understands how these things connect: a cancelled class means a changed commute, a new homework assignment becomes a task with a deadline, and a calendar event shows the route to get there.

<p align="center">
  <img src=".github/readme/connected.svg" alt="A cancelled lesson moves the departure time and the task that belongs to it." width="100%">
</p>

<p align="center">
  <img src="landing-page/public/screens/heute.webp" alt="The overview on a desktop: the next lesson, today's tasks and what is due this week." width="74%">
  <img src="landing-page/public/screens/phone-heute.webp" alt="The same overview on a phone." width="21.4%">
</p>

The interface is German. Up to version 0.4 Hora was called Nexus.

## Download

The current version is 0.6.0, a beta. Get it from the [download page](https://hora-app.netlify.app/download) or from [GitHub Releases](https://github.com/LeonManuel0705/Hora-Release/releases).

| Platform | What you get |
|:---|:---|
| macOS | Native app. On Apple silicon it brings its own backend and needs no Python. On Intel Macs it needs Python 3 installed and kept; the first start sets up its own Python environment from it and installs its packages once, which takes a few minutes. |
| Windows | Installer for the desktop app, backend included. |
| Linux | AppImage of the desktop app, backend included. |
| Android | Signed app package. |
| iPhone, iPad, browser | Web app, open it from the download page and add it to the home screen. |

On macOS the quickest way is the install script:

```bash
curl -sL https://hora-app.netlify.app/install-macos.sh | bash
```

It checks the checksum of the download, moves Hora into `/Applications` and removes the download quarantine. The app is signed ad hoc and not notarized, so without that step Gatekeeper would block the first launch.

**Coming from Nexus?** Your data comes along. On the first start the desktop apps take over the data of an existing Nexus installation.

**The assistant is a separate download.** No app ships the language model. The first time you open the assistant, Hora asks whether to install it. One click downloads the model (Gemma 4 E2B, about 3 GB) and, on desktops, the llama.cpp runtime for your system (11 to 32 MB), checks both against pinned SHA-256 sums and resumes where it stopped after an interruption. Afterwards the assistant runs entirely on the device. Settings → Assistent removes it again.

## What is inside

| | |
|:---|:---|
| **Overview** | The next lesson with room, teacher and minutes left, today's tasks, everything due, and the week at a glance. |
| **School** | Timetable with A and B weeks, subjects, grades, tests and exams, and the substitution plan straight from IServ. |
| **Tasks** | Tasks by subject and due date, with reminders that carry the study material for a test or the note for a presentation. |
| **Calendar** | Your own events next to Google Calendar, CalDAV and the macOS calendar. |
| **Transit** | Door to door routes in Berlin and Brandenburg with walking legs, VBB fares and the tickets you already own. |
| **Mail** | Read and answer mail from IMAP and SMTP accounts and from Gmail. |
| **Assistant** | A language model that runs on the device and can create tasks and homework for you. Works offline. |
| **Focus** | A Pomodoro timer, notes, bookmarks, spaced repetition and a training tracker. |
| **Backup** | One file carries timetable, subjects, grades, tests, tasks, events and places to another device, without doubling what is already there. |
| **Sync** | With an optional account, your timetable, first name and profile picture reach all your devices, end to end encrypted. A beta for now. |

<img src=".github/readme/luna.svg" alt="Luna, a small octopus" width="96" align="right">

**And Luna.** The small octopus shows new users around, keeps you company while something loads and sleeps when the day is done.

## Privacy

Everything you enter stays on your device. Hora has no analytics, no tracking and no crash reports, and it works offline once it is set up.

**The account is optional** and still a beta. With an account, Hora keeps your timetable, your first name and your profile picture the same on all your devices. The app encrypts them on the device with AES-256 before they leave it, using a key derived from your password that never leaves the device. The service at Cloudflare, with its database in the EU, stores your email address, a check value for your password and the encrypted entries, and cannot read them. Deleting the account removes all of it from the cloud.

Logins for IServ, mail and Google stay encrypted on the device and are never synced. The [privacy page](https://hora-app.netlify.app/privacy-philosophy) lists every connection Hora makes and why, the [privacy policy](https://hora-app.netlify.app/datenschutz) has the details.

## License

Hora is dual licensed.

**[PolyForm Noncommercial 1.0.0](LICENSE)** for everyone who does not earn money
with it. Free to use, study, change and share, for students, teachers, schools
and school authorities alike. Changed versions and every part of the code fall
under the same terms: pass them on free of charge or use them yourself.

**[Commercial license](COMMERCIAL-LICENSE.md)** for anyone who wants to earn
money with Hora or with any part of its code, for example by selling it,
hosting it for others as a paid service or building it into a product.

Copyright (C) 2026 Leon Manuel Töpper. See [NOTICE](NOTICE) for the full
statement, including the license history: Hora was published under the MIT
License until 2026-09-20 and under the AGPL-3.0 up to version 0.5.2. Both offers
have been withdrawn.

Contributions require the [CLA](licensing/CLA.md), which is what keeps the dual
license possible. See [CONTRIBUTING.md](CONTRIBUTING.md).
