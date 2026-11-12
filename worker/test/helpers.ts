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
