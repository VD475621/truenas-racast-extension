import React from "react";
import { showToast, Toast, getPreferenceValues, List, ActionPanel, Action } from "@raycast/api";
import { TrueNASClient, AppState } from "./lib/truenas";

// Get preferences
const preferences = getPreferenceValues<{
  address: string;
  apiKey: string;
  secure: boolean;
}>();

// Global client instance - will be created lazily
let client: TrueNASClient | null = null;

// Function to get or create client instance
function getClient(): TrueNASClient {
  if (!client) {
    client = new TrueNASClient({
      host: preferences.address,
      apiKey: preferences.apiKey,
      secure: preferences.secure,
    });
  }
  return client;
}

// Function to ensure client is connected with retry logic
async function ensureConnected(): Promise<void> {
  const maxRetries = 3;
  let retries = 0;
  
  while (retries < maxRetries) {
    try {
      const clientInstance = getClient();
      if (!clientInstance.isConnected()) {
        await clientInstance.connect();
        // Wait a bit more to ensure connection is fully established
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      return; // Connection successful
    } catch (error) {
      retries++;
      if (retries >= maxRetries) {
        throw error;
      }
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, 1000 * retries));
    }
  }
}

// Fetch the list of applications using TrueNAS client
async function fetchApps(): Promise<AppState[]> {
  try {
    await ensureConnected();
    const clientInstance = getClient();
    return await clientInstance.getApps();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
    showToast({ style: Toast.Style.Failure, title: "Error fetching apps", message: errorMessage });
    return [];
  }
}

// Function to start an application
async function startApp(appName: string, state: string) {
  if (state === "ACTIVE") {
    showToast({ style: Toast.Style.Failure, title: "Application is already running" });
    return;
  }

  try {
    await ensureConnected();
    const clientInstance = getClient();
    await clientInstance.startApp(appName);
    showToast({
      style: Toast.Style.Success,
      title: "Application started successfully",
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
    showToast({ style: Toast.Style.Failure, title: "Error starting app", message: errorMessage });
  }
}

// Function to stop an application
async function stopApp(appName: string, state: string) {
  if (state === "STOPPED") {
    showToast({ style: Toast.Style.Failure, title: "Application is already stopped" });
    return;
  }

  try {
    await ensureConnected();
    const clientInstance = getClient();
    await clientInstance.stopApp(appName);
    showToast({
      style: Toast.Style.Success,
      title: "Application stopped successfully",
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
    showToast({ style: Toast.Style.Failure, title: "Error stopping app", message: errorMessage });
  }
}

async function restartApp(appName: string, state: string) {
  if (state === "STOPPED") {
    showToast({ style: Toast.Style.Failure, title: "Application is stopped" });
    return;
  }

  try {
    await ensureConnected();
    const clientInstance = getClient();
    await clientInstance.restartApp(appName);
    showToast({ style: Toast.Style.Success, title: "Application restarted successfully" });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
    showToast({ style: Toast.Style.Failure, title: "Error restarting app", message: errorMessage });
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
      if (client && client.isConnected()) {
        client.disconnect();
        client = null;
      }
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
