/** Muistissa toimiva Workers KV -korvike testeihin. */
export function memoryKv(): KVNamespace & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: async (key: string, type?: string) => {
      const value = data.get(key);
      return value === undefined ? null : type === "json" ? JSON.parse(value) : value;
    },
    put: async (key: string, value: string) => void data.set(key, value),
    delete: async (key: string) => void data.delete(key),
    list: async ({ prefix = "" }: { prefix?: string } = {}) => ({
      keys: [...data.keys()].filter((name) => name.startsWith(prefix)).map((name) => ({ name })),
      list_complete: true,
    }),
  } as unknown as KVNamespace & { data: Map<string, string> };
}

/** ISS:n ratatiedot 12.11.2026 (CelesTrak): ylilentotestit laskevat näistä toistettavasti. */
export const ISS_TLE = `ISS (ZARYA)
1 25544U 98067A   26316.43260916  .00008191  00000+0  15481-3 0  9999
2 25544  51.6324 286.4897 0007327  17.4271 342.6968 15.49332729594739
`;
