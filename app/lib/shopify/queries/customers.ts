export const BULK_CUSTOMERS_QUERY = `
{
  customers {
    edges {
      node {
        id
        firstName
        lastName
        email
        phone
        note
        tags
        taxExempt
        addresses {
          address1
          address2
          city
          provinceCode
          countryCodeV2
          zip
          phone
          firstName
          lastName
          company
        }
      }
    }
  }
}`;

export const CUSTOMER_BY_EMAIL_QUERY = `#graphql
  query duplifyCustomerByEmail($query: String!) {
    customers(first: 1, query: $query) {
      edges { node { id email } }
    }
  }
`;
