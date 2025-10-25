import React from "react";
import { showToast, Toast, getPreferenceValues, List, ActionPanel, Action } from "@raycast/api";
import { TrueNASClient, VMState } from "./lib/truenas";

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

// Function to fetch the list of VMs using the TrueNAS client
async function fetchVMs(): Promise<VMState[]> {
  try {
    await ensureConnected();
    const clientInstance = getClient();
    return await clientInstance.getVMs();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
    showToast({ style: Toast.Style.Failure, title: "Error fetching VMs", message: errorMessage });
    return [];
  }
}

// Function to manage virtual machines using the TrueNAS client
async function manageVM(action: "start" | "stop", vmId: number, state: string) {
  if (state === "RUNNING" && action === "start") {
    showToast({ style: Toast.Style.Failure, title: "VM is already running" });
    return;
  } else if (state === "STOPPED" && action === "stop") {
    showToast({ style: Toast.Style.Failure, title: "VM is already stopped" });
    return;
  }

  try {
    await ensureConnected();
    const clientInstance = getClient();

    if (action === "start") {
      await clientInstance.startVM(vmId);
      showToast({ style: Toast.Style.Success, title: "VM started successfully" });
    } else {
      await clientInstance.stopVM(vmId);
      showToast({ style: Toast.Style.Success, title: "VM stopped successfully" });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
    showToast({ style: Toast.Style.Failure, title: `Error ${action}ing VM`, message: errorMessage });
  }
}

// Function to restart a virtual machine using the TrueNAS client
async function restartVM(vmId: number, state: string) {
  if (state === "STOPPED") {
    showToast({ style: Toast.Style.Failure, title: "VM is stopped" });
    return;
  }

  try {
    await ensureConnected();
    const clientInstance = getClient();
    await clientInstance.restartVM(vmId);
    showToast({ style: Toast.Style.Success, title: "VM restarted successfully" });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
    showToast({ style: Toast.Style.Failure, title: "Error restarting VM", message: errorMessage });
  }
}

// Main command
export default function Command() {
  const [vms, setVMs] = React.useState<VMState[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    async function loadVMs() {
      const vmList = await fetchVMs();
      setVMs(vmList);
      setIsLoading(false);
    }

    loadVMs();
  }, []);

  // Cleanup function to disconnect client when component unmounts
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
      {vms.map((vm) => (
        <List.Item
          key={vm.id}
          title={vm.name}
          subtitle={`Status: ${vm.status.state}`}
          actions={
            <ActionPanel>
              <Action title="Start VM" onAction={() => manageVM("start", vm.id, vm.status.state)} />
              <Action title="Stop VM" onAction={() => manageVM("stop", vm.id, vm.status.state)} />
              <Action title="Restart VM" onAction={() => restartVM(vm.id, vm.status.state)} />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}
