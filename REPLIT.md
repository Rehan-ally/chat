# Publish FLOW on Replit

FLOW uses a Replit PostgreSQL database when `DATABASE_URL` is available. Locally, it continues to use `data/flow-data.json`.

1. Import this project into Replit from its GitHub repository.
2. In the Replit editor, open **Tools → Database** and make sure the app has a PostgreSQL database.
3. Run the app in the editor and check that it starts and opens the FLOW page.
4. Open **Publish** and choose **Reserved VM** for now. FLOW currently keeps a working copy of its data and login sessions in server memory, so do not run multiple app instances.
5. Publish the app. Replit uses a separate production database for the published app; let it create that database when prompted. The app will create its storage table on startup.
6. Open the public URL and create accounts there. The local `data/flow-data.json` file is not automatically copied to the production database.

Keep the database connection string private. Do not paste it into chat or commit it to the repository. Replit manages it through the app's environment.

The production database stores accounts and conversations centrally, so signed-in users can reach their messages from different devices. FLOW does not currently store chat history only on each user's device.
