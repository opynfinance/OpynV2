const yargs = require('yargs')
const Oracle = artifacts.require('Oracle.sol')

const apis = require('./dataUtils')

/**
 * @example
 * truffle exec scripts/migrateOracle.js
 *  --network kovan
 *  --internal true
 *  --newOracle 0x8b71104e11931775957932728717b0F81461bc0d
 *  --asset 0x50570256f0da172a1908207aAf0c80d4b279f303
 *  --coinId bitcoin
 */
module.exports = async function(callback) {
  try {
    const options = yargs
      .usage(
        'Usage: --network <network> --internal <internal> --newOracle <newOracle> --asset <asset> --coinId <coinId> --gasPrice <gasPrice>',
      )
      .option('network', { describe: '0x exchange address', type: 'string', demandOption: true })
      .option('newOracle', { describe: 'New oracle module address', type: 'string', demandOption: true })
      .option('asset', { describe: 'Asset address to migrate', type: 'string', demandOption: true })
      .option('internal', { describe: 'Internal network or not', type: 'string', demandOption: true })
      .option('coinId', {
        describe: 'coingecko id used to search for price if it was not reported in our oracle',
        type: 'string',
      })
      .option('gasPrice', { describe: 'Gas price in WEI', type: 'string', demandOption: false }).argv

    console.log('Init contracts 🍕')

    const asset = options.asset.toLowerCase()

    const newOracle = await Oracle.at(options.newOracle)

    console.log(`Getting list of create Otokens with asset ${asset} 🍕`)

    const otokens = await apis.getOTokens(options.network, options.internal === 'true')

    console.log(`# of otokens from subgraph: ${otokens.length}`)

    const prices = await apis.getAllSettlementPrices(asset, options.network, options.internal === 'true')

    const oTokensWithAsset = otokens.filter(
      otoken =>
        otoken.underlyingAsset.id === asset || otoken.collateralAsset.id === asset || otoken.strikeAsset.id === asset,
    )

    const filteredExpiries = oTokensWithAsset.reduce((prev, curr) => {
      if (!prev.includes(curr.expiryTimestamp)) {
        return [...prev, curr.expiryTimestamp]
      } else {
        return [...prev]
      }
    }, [])

    console.log(`expires needed to fill in ${filteredExpiries.length}`)

    const knownRecordSubgraph = prices.filter(priceObj => filteredExpiries.includes(priceObj.expiry))

    const knownPrices = knownRecordSubgraph.map(obj => obj.price)
    const knownExpires = knownRecordSubgraph.map(obj => obj.expiry)

    let finalPrices = []
    let finalExpires = []

    const missingExpires = filteredExpiries.filter(
      expiry => !knownRecordSubgraph.map(obj => obj.expiry).includes(expiry),
    )

    if (options.coinId) {
      console.log(`Using coinID ${options.coinId} to fill in ${missingExpires.length} missing prices! `)

      const missingPrices = []
      for (const expiry of missingExpires) {
        const price = await apis.getCoinGeckData(options.coinId, expiry)
        missingPrices.push(price.toString())
        console.log(`Got price for expiry ${expiry} from CoinGeck: ${price}`)
      }

      finalPrices = [...knownPrices, ...missingPrices]
      finalExpires = [...knownExpires, ...missingExpires]
    } else {
      if (missingExpires.length > 0) {
        console.log(
          `Missing ${missingExpires.length} prices to support redeeming all options. Please put in coinId to fetch those `,
        )
      }

      finalPrices = knownPrices
      finalExpires = knownExpires
    }

    console.log(`Final expires`, finalExpires)
    console.log(`Final prices`, finalPrices)

    // console.log(`Found ${expiriesToMigrate.length} expiry price 🎉`)

    if (finalPrices.length === 0) throw 'Nothing to Migrate'

    console.log(`Migrating prices to new Oracle at ${newOracle.address} 🎉`)

    const overrideOptions = options.gasPrice ? { gasPrice: options.gasPrice } : undefined
    const tx = await newOracle.migrateOracle(options.asset, finalExpires, finalPrices, overrideOptions)

    console.log(`Oracle prices migration done for asset ${options.asset}! 🎉`)
    console.log(`Transaction hash: ${tx.tx}`)

    callback()
  } catch (err) {
    callback(err)
  }
}
