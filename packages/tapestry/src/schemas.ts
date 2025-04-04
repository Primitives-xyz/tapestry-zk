import * as borsh from "borsh";

export const accountKeySchema: borsh.Schema = {
  enum: [
    {
      struct: {
        uninitializedV1: "u16",
      },
    },
    {
      struct: {
        assetV1: {
          struct: {},
        },
      },
    },
    {
      struct: {
        metadataV1: {
          struct: {},
        },
      },
    },
    {
      struct: {
        transferDelegateV1: {
          struct: {},
        },
      },
    },
    {
      struct: {
        freezeDelegateV1: {
          struct: {},
        },
      },
    },
    {
      struct: {
        nodeV1: {
          struct: {},
        },
      },
    },
    {
      struct: {
        edgeV1: {
          struct: {},
        },
      },
    },
  ],
};

export const propertiesSchema: borsh.Schema = {
  struct: {
    key: "string",
    value: "string",
  },
};

export const creatorSchema: borsh.Schema = {
  struct: {
    address: { array: { type: "u8", len: 32 } },
    verified: "bool",
    share: "u8",
  },
};

export const nodeArgsSchema: borsh.Schema = {
  struct: {
    label: "string",
    properties: { array: { type: propertiesSchema } },
    isMutable: "bool",
    creators: { array: { type: creatorSchema } },
  },
};

export const edgeArgsSchema: borsh.Schema = {
  struct: {
    sourceNode: { array: { type: "u8", len: 32 } },
    targetNode: { array: { type: "u8", len: 32 } },
    edgeType: "string",
    properties: { array: { type: propertiesSchema } },
    isMutable: "bool",
  },
};

export const assetSchemaV1: borsh.Schema = {
  struct: {
    key: accountKeySchema,
    owner: { array: { type: "u8", len: 32 } },
    updateAuthorityType: "u8",
    updateAuthority: { array: { type: "u8", len: 32 } },
    initializedPlugins: "u16",
  },
};

export const nodeDataSchema: borsh.Schema = {
  struct: {
    propertiesBytes: { array: { type: "u8" } },
    creatorsBytes: { array: { type: "u8" } },
  },
};

export const nodeSchemaV1: borsh.Schema = {
  struct: {
    key: accountKeySchema,
    owner: { array: { type: "u8", len: 32 } },
    updateAuthority: {
      enum: [
        { struct: { none: { struct: {} } } },
        { struct: { address: { array: { type: "u8", len: 32 } } } },
      ],
    },
    label: "string",
    nodeData: nodeDataSchema,
    isMutable: "bool",
    initializedPlugins: "u16",
  },
};

export const edgeSchemaV1: borsh.Schema = {
  struct: {
    key: accountKeySchema,
    owner: { array: { type: "u8", len: 32 } },
    updateAuthority: { array: { type: "u8", len: 32 } },
    sourceNode: { array: { type: "u8", len: 32 } },
    targetNode: { array: { type: "u8", len: 32 } },
    edgeType: "string",
    properties: { array: { type: propertiesSchema } },
    isMutable: "bool",
    initializedPlugins: "u16",
  },
};

export const metadataSchemaV1: borsh.Schema = {
  struct: {
    key: "u8",
    metadataUriType: "u8",
    uri: "string",
    assetId: { array: { type: "u8", len: 32 } },
  },
};

export const freezeDelegateSchemaV1: borsh.Schema = {
  struct: {
    key: accountKeySchema,
    authority: { array: { type: "u8", len: 32 } },
  },
};

export const stakeRecordSchemaV1: borsh.Schema = {
  struct: {
    assetId: { array: { type: "u8", len: 32 } },
    staker: { array: { type: "u8", len: 32 } },
    collectionId: { array: { type: "u8", len: 32 } },
    startTime: "i64",
  },
};

// Create a very simplified version of the nodeSchema that handles the binary format directly
// Without using custom enum types that are causing issues
export const rawNodeSchema: borsh.Schema = {
  struct: {
    key: "u8", // AccountKey is a simple u8
    owner: { array: { type: "u8", len: 32 } },
    updateAuthorityTag: "u8", // Just the tag value (0 or 1)
    // The update authority is serialized differently than a standard option
    // It appears to be a raw value, not an optional field
    updateAuthorityData: { array: { type: "u8", len: 32 } }, // This is always present, not optional
    label: "string",
    nodeData: {
      struct: {
        propertiesBytes: { array: { type: "u8" } },
        creatorsBytes: { array: { type: "u8" } },
      },
    },
    isMutable: "bool",
    initializedPlugins: "u16",
  },
};

// Create a schema based on the observed buffer layout from our debugging
export const rawEdgeSchema: borsh.Schema = {
  struct: {
    key: "u8", // AccountKey (1 for EdgeV1)
    sourceNode: { array: { type: "u8", len: 32 } }, // Full 32-byte source node Pubkey
    targetNode: { array: { type: "u8", len: 32 } }, // Full 32-byte target node Pubkey
    edgeType: "string", // Borsh handles u32 len + bytes
    // Properties are serialized in the edgeData field
    edgeData: {
      struct: {
        propertiesBytes: { array: { type: "u8" } }, // Not hashed, just serialized properties
      },
    },
    isMutable: "bool",
    owner: { array: { type: "u8", len: 32 } }, // Owner Pubkey
    updateAuthorityTag: "u8", // UpdateAuthority enum tag
    updateAuthorityData: { array: { type: "u8", len: 32 } }, // UpdateAuthority data
    initializedPlugins: "u16",
  },
};
