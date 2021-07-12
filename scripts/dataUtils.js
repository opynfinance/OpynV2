const fetch = require('node-fetch')

const postQuery = async (endpoint, query) => {
  const options = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  }
  const url = endpoint
  const response = await fetch(url, options)
  const data = await response.json()
  if (data.errors) {
    throw new Error(data.errors[0].message)
  } else {
    return data
  }
}

const getSubgraphUrl = (network, internal) => {
  const prefix = internal ? 'gamma-internal' : 'gamma'
  let url = `https://api.thegraph.com/subgraphs/name/opynfinance/${prefix}-${network}`
  if (network === 'mainnet' && internal) {
    url = 'https://api.thegraph.com/subgraphs/name/opynfinance/playground'
  }
  console.log(`Using subgraph endpoint`, url)
  return url
}

/**
 * Get all oTokens
 * @returns {Promise<any[]>}
 */
module.exports.getOTokens = async (network, internal) => {
  const currentTimeStamp = Math.floor(Date.now() / 1000)

  const query = `
  {
    otokens (
      first: 1000,
      where: {
        expiryTimestamp_lt: ${currentTimeStamp},
      }
    )  {
      strikeAsset {
        id
      }
      underlyingAsset {
        id
      }
      collateralAsset {
        id
      }
      isPut
      expiryTimestamp
    }
  }`
  try {
    const url = getSubgraphUrl(network, internal)
    const response = await postQuery(url, query)
    return response.data.otokens
  } catch (error) {
    console.error(error)
    return []
  }
}

/**
 * Get all oTokens
 */
module.exports.getAllSettlementPrices = async (asset, network, internal) => {
  const query = `
  {
    expiryPrices(
      first: 1000,
      where: {
        asset: "${asset}"
      }
    ){
      expiry
      price
    }
  }
  
  `
  try {
    const url = getSubgraphUrl(network, internal)
    const response = await postQuery(url, query)
    return response.data.expiryPrices
  } catch (error) {
    console.error(error)
    throw 'WTF'
    return null
  }
}

/**
 *
 */
module.exports.getCoinGeckData = async (coinId, expiry) => {
  const date = new Date(expiry * 1000)
  const yyyymmdd = date.toISOString().split('T')[0]
  const [year, month, day] = yyyymmdd.split('-')
  const dateString = `${day}-${month}-${year}`
  const url = `https://api.coingecko.com/api/v3/coins/${coinId}/history?date=${dateString}&localization=false`
  const data = await (await fetch(url)).json()
  return Math.floor(data.market_data.current_price.usd * 1e8)
}
