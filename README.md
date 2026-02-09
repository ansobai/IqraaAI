# IqraaAI (Expo + FastAPI + Postgres)

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

## Auth (Clerk)

1. Copy `.env.example` to `.env`
2. Set `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` to your Clerk publishable key
3. Set `EXPO_PUBLIC_API_URL` (example: `http://localhost:8000`)

> Android emulator note: if you use `http://localhost:8000`, the app automatically rewrites it to `http://10.0.2.2:8000` on Android.

## Backend API (FastAPI)

1. Install Python deps

   ```bash
   python -m pip install -r api/requirements.txt
   ```

2. Configure backend env

   ```bash
   cp api/.env.example api/.env
   ```

   Required:
   - `DATABASE_URL`
   - `CLERK_ISSUER` (must match the JWT `iss` claim)

3. Apply DB schema

   ```bash
   python api/scripts/apply_schema.py
   ```

4. Run the API

   ```bash
   python -m uvicorn api.app.main:app --reload --port 8000
   ```

## Database (Postgres)

- Schema: `db/schema.sql`
- Supabase data migration (optional): `db/MIGRATION.md`

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.
