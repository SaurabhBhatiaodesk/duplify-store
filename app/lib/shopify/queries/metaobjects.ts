export const METAOBJECT_DEFINITIONS_QUERY = `#graphql
  query duplifyMetaobjectDefinitions($after: String) {
    metaobjectDefinitions(first: 100, after: $after) {
      edges {
        node {
          type
          name
          fieldDefinitions {
            key
            name
            required
            type { name }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export const METAOBJECTS_BY_TYPE_QUERY = `#graphql
  query duplifyMetaobjectsByType($type: String!, $after: String) {
    metaobjects(type: $type, first: 100, after: $after) {
      edges {
        node {
          id
          handle
          fields { key value type }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;
