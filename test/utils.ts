import {MockERC20Instance} from '../build/types/truffle-types'
import BigNumber from 'bignumber.js'

const util = require('@0x/protocol-utils')
const ethSigUtil = require('eth-sig-util')

export type vault = {
  shortAmounts: (BigNumber | string | number)[]
  longAmounts: (BigNumber | string | number)[]
  collateralAmounts: (BigNumber | string | number)[]
  shortOtokens: string[]
  longOtokens: string[]
  collateralAssets: string[]
}

/**
 * Return a valid expiry timestamp that's today + # days, 0800 UTC.
 * @param now
 * @param days
 */
export const createValidExpiry = (now: number, days: number) => {
  const multiplier = (now - 28800) / 86400
  return (Number(multiplier.toFixed(0)) + 1) * 86400 + days * 86400 + 28800
}

/**
 * Create a vault for testing
 * @param shortOtoken
 * @param longOtoken
 * @param collateralAsset
 * @param shortAmount
 * @param longAmount
 * @param collateralAmount
 */
export const createVault = (
  shortOtoken: string | undefined,
  longOtoken: string | undefined,
  collateralAsset: string | undefined,
  shortAmount: string | BigNumber | number | undefined,
  longAmount: string | BigNumber | number | undefined,
  collateralAmount: string | BigNumber | number | undefined,
): vault => {
  return {
    shortOtokens: shortOtoken ? [shortOtoken] : [],
    longOtokens: longOtoken ? [longOtoken] : [],
    collateralAssets: collateralAsset ? [collateralAsset] : [],
    shortAmounts: shortAmount !== undefined ? [shortAmount] : [],
    longAmounts: longAmount !== undefined ? [longAmount] : [],
    collateralAmounts: collateralAmount !== undefined ? [collateralAmount] : [],
  }
}

export const createTokenAmount = (num: number | BigNumber, decimals = 8) => {
  const amount = new BigNumber(num).times(new BigNumber(10).pow(decimals))
  return amount.integerValue().toString()
}

/**
 * Create a number string that scales numbers to 1e18
 * @param num
 */
export const createScaledNumber = (num: number, decimals = 8): string => {
  return new BigNumber(num).times(new BigNumber(10).pow(decimals)).toString()
}

/**
 * Create a number string that scales numbers to 1e18
 * @param num
 */
export const createScaledBigNumber = (num: number, decimals = 8): BigNumber => {
  return new BigNumber(num).times(new BigNumber(10).pow(decimals))
}

export const underlyingPriceToCtokenPrice = async (
  underlyingPrice: BigNumber,
  exchangeRate: BigNumber,
  underlying: MockERC20Instance,
) => {
  const underlyingDecimals = new BigNumber(await underlying.decimals())
  const cTokenDecimals = new BigNumber(8)
  return exchangeRate
    .times(underlyingPrice)
    .times(new BigNumber(10).exponentiatedBy(cTokenDecimals))
    .div(new BigNumber(10).exponentiatedBy(underlyingDecimals.plus(new BigNumber(18))))
    .integerValue(BigNumber.ROUND_DOWN)
}

export const underlyingPriceToYTokenPrice = async (
  underlyingPrice: BigNumber,
  pricePerShare: BigNumber,
  underlying: MockERC20Instance,
) => {
  const underlyingDecimals = new BigNumber(await underlying.decimals())
  return pricePerShare
    .times(underlyingPrice)
    .div(new BigNumber(10).exponentiatedBy(underlyingDecimals))
    .integerValue(BigNumber.ROUND_DOWN)
}

/**
 * @param {number} num number to scale
 * @param {number} fromDecimal the decimals the original number has
 * @param {number} toDecimal the decimals the target number has
 * @return {BigNumber}
 */
export const changeAmountScaled = (num: number | string, fromDecimal: number, toDecimal: number) => {
  const numBN = new BigNumber(num)
  if (toDecimal === fromDecimal) {
    return numBN
  } else if (toDecimal >= fromDecimal) {
    return numBN.times(new BigNumber(10).pow(toDecimal - fromDecimal))
  } else {
    return numBN.div(new BigNumber(10).pow(fromDecimal - toDecimal)).integerValue()
  }
}

export const createOrder = (
  maker: string,
  makerToken: string,
  takerToken: string,
  makerAmount: BigNumber,
  takerAmount: BigNumber,
  chainId: number,
) => {
  const expiry = (Date.now() / 1000 + 240).toFixed(0)
  const salt = (Math.random() * 1000000000000000000).toFixed(0)
  const order = new util.LimitOrder({
    makerToken: makerToken,
    takerToken: takerToken,
    makerAmount: makerAmount.toString(),
    takerAmount: takerAmount.toString(),
    takerTokenFeeAmount: '0',
    maker: maker,
    taker: '0x0000000000000000000000000000000000000000',
    sender: '0x0000000000000000000000000000000000000000',
    feeRecipient: '0x1000000000000000000000000000000000000011',
    pool: '0x0000000000000000000000000000000000000000000000000000000000000000',
    expiry: expiry.toString(),
    salt: salt,
    chainId: chainId,
  })
  return order
}

export const signOrder = async (signer: any, order: any, key: any) => {
  const signature = await order.getSignatureWithKey(key, util.SignatureType.EIP712)
  // eslint-disable-next-line no-param-reassign
  order.signature = signature
  return order
}

export const expectedLiqudidationPrice = (
  collateral: number | string,
  debt: number,
  cashValue: number,
  spotPrice: number,
  oracleDeviation: number,
  auctionStartingTime: number,
  currentBlockTime: number,
  isPut: boolean,
  collateralDecimals: number,
) => {
  const endingPrice = new BigNumber(collateral).dividedBy(debt)
  const auctionElapsedTime = currentBlockTime - auctionStartingTime

  if (auctionElapsedTime > 5400) {
    // return Math.floor(endingPrice)
    return endingPrice.multipliedBy(10 ** collateralDecimals).toNumber()
  }

  let startingPrice

  if (isPut) {
    startingPrice = BigNumber.max(
      new BigNumber(cashValue).minus(new BigNumber(spotPrice).multipliedBy(oracleDeviation)),
      0,
    )
  } else {
    startingPrice = BigNumber.max(
      new BigNumber(cashValue).minus(new BigNumber(spotPrice).multipliedBy(oracleDeviation)),
      0,
    ).dividedBy(spotPrice)
  }

  const price = startingPrice
    .plus(
      endingPrice
        .minus(startingPrice)
        .multipliedBy(auctionElapsedTime)
        .dividedBy(5400),
    )
    .multipliedBy(10 ** collateralDecimals)

  if (price.isGreaterThan(endingPrice.multipliedBy(10 ** collateralDecimals)))
    return endingPrice.multipliedBy(10 ** collateralDecimals).toNumber()

  return price.toNumber()
}

export const calcRelativeDiff = (expected: BigNumber, actual: BigNumber): BigNumber => {
  return actual.minus(expected).abs()
}
