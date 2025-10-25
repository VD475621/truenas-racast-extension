import React from "react";
import { showToast, Toast, getPreferenceValues, List, ActionPanel, Action } from "@raycast/api";
import { TrueNASClient, AppState } from "./lib/truenas";

// Get preferences
const preferences = getPreferenceValues<{
  address: string;
  apiKey: string;
  secure: boolean;
}>();

// Create TrueNAS client instance
const client = new TrueNASClient({
  host: preferences.address,
  apiKey: preferences.apiKey,
  secure: preferences.secure,
});

// Fetch the list of applications using TrueNAS client
async function fetchApps(): Promise<AppState[]> {
  try {
    // Connect to TrueNAS if not already connected
    if (!client.isConnected()) {
      await client.connect();
    }

    // Fetch apps using the client
    const apps = await client.getApps();
    return apps;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
    showToast({ style: Toast.Style.Failure, title: `Error`, message: errorMessage });
    return [];
  }
}

// Function to start an application
async function startApp(appName: string, state: string) {
  if (state === "ACTIVE") {
    showToast({ style: Toast.Style.Failure, title: `Application is already running` });
    return;
  }

  try {
    // Ensure connection
    if (!client.isConnected()) {
      await client.connect();
    }

    await client.startApp(appName);
    showToast({
      style: Toast.Style.Success,
      title: `Application started successfully`,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
    showToast({ style: Toast.Style.Failure, title: `Error`, message: errorMessage });
  }
}

// Function to stop an application
async function stopApp(appName: string, state: string) {
  if (state === "STOPPED") {
    showToast({ style: Toast.Style.Failure, title: `Application is already stopped` });
    return;
  }

  try {
    // Ensure connection
    if (!client.isConnected()) {
      await client.connect();
    }

    await client.stopApp(appName);
    showToast({
      style: Toast.Style.Success,
      title: `Application stopped successfully`,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
    showToast({ style: Toast.Style.Failure, title: `Error`, message: errorMessage });
  }
}

async function restartApp(appName: string, state: string) {
  if (state === "STOPPED") {
    showToast({ style: Toast.Style.Failure, title: `Application is stopped` });
    return;
  }

  try {
    // Ensure connection
    if (!client.isConnected()) {
      await client.connect();
    }

    await client.restartApp(appName);
    showToast({ style: Toast.Style.Success, title: `Application restarted successfully` });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
    showToast({ style: Toast.Style.Failure, title: `Error`, message: errorMessage });
  }
}

// Main component
export default function Command() {
  const [apps, setApps] = React.useState<AppState[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);

  // Fetch the list of applications when the component mounts
  React.useEffect(() => {
    async function loadApps() {
      const fetchedApps = await fetchApps();
      setApps(fetchedApps);
      setIsLoading(false);
    }
    loadApps();
  }, []);

  // Clean up WebSocket connection when component unmounts
  React.useEffect(() => {
    return () => {
      client.disconnect();
    };
  }, []);

  return (
    <List isLoading={isLoading}>
      {apps.map((app) => (
        <List.Item
          key={app.id}
          title={app.name}
          subtitle={`State: ${app.state}`}
          actions={
            <ActionPanel>
              <Action title="Start" onAction={() => startApp(app.name, app.state)} />
              <Action title="Stop" onAction={() => stopApp(app.name, app.state)} />
              <Action title="Restart" onAction={() => restartApp(app.name, app.state)} />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}
