
module.exports = [
  {
    name: "distributed-cache",
    url: "https://api.github.com",
    repo: "microlib-example",
    owner: "module-federation",
    filedir: "dist",
    branch: "cache",
    path: __dirname,
    type: "model-cache",
    importRemote: async () =>
      Object.values((await import("distributed-cache/model-cache")).models),
  },
  {
    name: "adapter-cache",
    url: "https://api.github.com",
    repo: "microlib-example",
    owner: "module-federation",
    filedir: "dist",
    branch: "cache",
    path: __dirname,
    type: "adapter-cache",
    importRemote: async () => import("distributed-cache/adapter-cache"),
  },
  {
    name: "service-cache",
    url: "https://api.github.com",
    repo: "microlib-example",
    owner: "module-federation",
    filedir: "dist",
    branch: "cache",
    path: __dirname,
    type: "service-cache",
    importRemote: async () => import("distributed-cache/service-cache"),
  },
]
