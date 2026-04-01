export type AiTosRawContract = Record<string, unknown>;

export type AiTosCarUserInfo = {
  contract: AiTosRawContract;
  user?: {
    id?: string | number;
    name?: string;
    [key: string]: unknown;
  };
  car?: {
    id?: string | number;
    plate?: string;
    [key: string]: unknown;
  };
};

export async function fetchAiTosContracts(): Promise<AiTosRawContract[]> {
  const res = await fetch("https://ai-tos.mn/api/contracts", {
    cache: "no-store",
    headers: {
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ai-tos contracts request failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as unknown;

  if (!Array.isArray(data)) {
    throw new Error("ai-tos contracts response is not an array");
  }

  return data as AiTosRawContract[];
}

export async function getAiTosCarUsers(): Promise<AiTosCarUserInfo[]> {
  const contracts = await fetchAiTosContracts();

  return contracts.map((contract) => {
    const user = (contract as any).user as AiTosCarUserInfo["user"] | undefined;
    const car = (contract as any).car as AiTosCarUserInfo["car"] | undefined;

    return {
      contract,
      user,
      car,
    };
  });
}

