import { expect } from 'chai'
import { BigNumber } from 'ethers'
import BalanceTree from './utils/merkle/balance-tree'
import { deploy, getAccounts } from './utils/helpers'
import { ERC677, MerkleDistributor } from '../typechain-types'
import { ethers } from 'hardhat'
import { time } from '@nomicfoundation/hardhat-network-helpers'

// Copied and modified from: https://github.com/Uniswap/merkle-distributor/blob/master/test/MerkleDistributor.spec.ts
// to test contract changes.
// Most tests have been removed as core functionality has not changed, focus on testing multiple distributions

const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000'

describe('MerkleDistributor', () => {
  let accounts: string[]
  let wallet0: string
  let wallet1: string
  let token: ERC677

  before(async () => {
    ;({ accounts } = await getAccounts())
  })

  beforeEach('deploy token', async () => {
    wallet0 = accounts[1]
    wallet1 = accounts[2]

    token = (await deploy('ERC677', ['Token', 'TKN', 1000000])) as ERC677
  })

  describe('#claim', () => {
    it('fails for empty proof', async () => {
      const distributor = (await deploy('MerkleDistributor')) as MerkleDistributor
      await distributor.addDistribution(token.address, ZERO_BYTES32, BigNumber.from(0))
      await expect(
        distributor.claimDistribution(token.address, 0, wallet0, 10, [])
      ).to.be.revertedWith('MerkleDistributor: Invalid proof.')
    })

    describe('two account tree', () => {
      let distributor: MerkleDistributor
      let tree: BalanceTree
      beforeEach('deploy', async () => {
        tree = new BalanceTree([
          { account: wallet0, amount: BigNumber.from(100) },
          { account: wallet1, amount: BigNumber.from(101) },
        ])
        distributor = (await deploy('MerkleDistributor')) as MerkleDistributor
        await token.approve(distributor.address, ethers.constants.MaxUint256)
        await distributor.addDistribution(token.address, tree.getHexRoot(), BigNumber.from(201))
      })

      it('successful claim', async () => {
        const proof0 = tree.getProof(0, wallet0, BigNumber.from(100))
        await expect(distributor.claimDistribution(token.address, 0, wallet0, 100, proof0))
          .to.emit(distributor, 'Claimed')
          .withArgs(token.address, 0, wallet0, 100)
        const proof1 = tree.getProof(1, wallet1, BigNumber.from(101))
        await expect(distributor.claimDistribution(token.address, 1, wallet1, 101, proof1))
          .to.emit(distributor, 'Claimed')
          .withArgs(token.address, 1, wallet1, 101)
      })

      it('transfers the token', async () => {
        const proof0 = tree.getProof(0, wallet0, BigNumber.from(100))
        expect(await token.balanceOf(wallet0)).to.eq(0)
        await distributor.claimDistribution(token.address, 0, wallet0, 100, proof0)
        expect(await token.balanceOf(wallet0)).to.eq(100)
      })

      it('increments claimed amount', async () => {
        const proof0 = tree.getProof(0, wallet0, BigNumber.from(100))
        expect(await distributor.getClaimed(token.address, wallet0)).to.eq(0)
        expect(await distributor.getClaimed(token.address, wallet1)).to.eq(0)
        await distributor.claimDistribution(token.address, 0, wallet0, 100, proof0)
        expect(await distributor.getClaimed(token.address, wallet0)).to.eq(100)
        expect(await distributor.getClaimed(token.address, wallet1)).to.eq(0)
      })

      it('cannot allow two claims', async () => {
        const proof0 = tree.getProof(0, wallet0, BigNumber.from(100))
        await distributor.claimDistribution(token.address, 0, wallet0, 100, proof0)
        await expect(
          distributor.claimDistribution(token.address, 0, wallet0, 100, proof0)
        ).to.be.revertedWith('MerkleDistributor: No claimable tokens')
      })

      it('cannot claim more than once: 0 and then 1', async () => {
        await distributor.claimDistribution(
          token.address,
          0,
          wallet0,
          100,
          tree.getProof(0, wallet0, BigNumber.from(100))
        )
        await distributor.claimDistribution(
          token.address,
          1,
          wallet1,
          101,
          tree.getProof(1, wallet1, BigNumber.from(101))
        )

        await expect(
          distributor.claimDistribution(
            token.address,
            0,
            wallet0,
            100,
            tree.getProof(0, wallet0, BigNumber.from(100))
          )
        ).to.be.revertedWith('MerkleDistributor: No claimable tokens.')
      })

      it('cannot claim more than once: 1 and then 0', async () => {
        await distributor.claimDistribution(
          token.address,
          1,
          wallet1,
          101,
          tree.getProof(1, wallet1, BigNumber.from(101))
        )
        await distributor.claimDistribution(
          token.address,
          0,
          wallet0,
          100,
          tree.getProof(0, wallet0, BigNumber.from(100))
        )

        await expect(
          distributor.claimDistribution(
            token.address,
            1,
            wallet1,
            101,
            tree.getProof(1, wallet1, BigNumber.from(101))
          )
        ).to.be.revertedWith('MerkleDistributor: No claimable tokens.')
      })

      it('cannot claim for address other than proof', async () => {
        const proof0 = tree.getProof(0, wallet0, BigNumber.from(100))
        await expect(
          distributor.claimDistribution(token.address, 1, wallet1, 101, proof0)
        ).to.be.revertedWith('MerkleDistributor: Invalid proof.')
      })

      it('cannot claim more than proof', async () => {
        const proof0 = tree.getProof(0, wallet0, BigNumber.from(100))
        await expect(
          distributor.claimDistribution(token.address, 0, wallet0, 101, proof0)
        ).to.be.revertedWith('MerkleDistributor: Invalid proof.')
      })

      it('cannot claim distribution that does not exist', async () => {
        const proof0 = tree.getProof(0, wallet0, BigNumber.from(100))
        await expect(
          distributor.claimDistribution(wallet1, 0, wallet0, 101, proof0)
        ).to.be.revertedWith('MerkleDistributor: Distribution does not exist.')
      })

      it('can set timeLimitEnabled', async () => {
        await distributor.setTimeLimitEnabled(token.address, true)
        expect((await distributor.distributions(token.address))[1]).to.eq(true)
        let ts = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp
        expect((await distributor.distributions(token.address))[3]).to.eq(ts)
        await expect(distributor.setTimeLimitEnabled(token.address, true)).to.be.revertedWith(
          'MerkleDistributor: Value already set.'
        )
        await distributor.setTimeLimitEnabled(token.address, false)
        expect((await distributor.distributions(token.address))[1]).to.eq(false)
        expect((await distributor.distributions(token.address))[3]).to.eq(ts)
        await expect(distributor.setTimeLimitEnabled(token.address, false)).to.be.revertedWith(
          'MerkleDistributor: Value already set.'
        )
      })

      it('can pause for withdrawal', async () => {
        await expect(distributor.pauseForWithdrawal(token.address)).to.be.revertedWith(
          'MerkleDistributor: Time limit is not enabled.'
        )
        await distributor.setTimeLimitEnabled(token.address, true)
        await expect(distributor.pauseForWithdrawal(token.address)).to.be.revertedWith(
          'Time limit has not been reached.'
        )
        await time.increase(91 * 86400)
        await distributor.pauseForWithdrawal(token.address)
        expect((await distributor.distributions(token.address))[2]).to.eq(true)
      })

      it('can withdraw unclaimed tokens', async () => {
        await expect(
          distributor.withdrawUnclaimedTokens(token.address, tree.getHexRoot())
        ).to.be.revertedWith('MerkleDistributor: Distribution is not paused.')
        await distributor.claimDistribution(
          token.address,
          1,
          wallet1,
          101,
          tree.getProof(1, wallet1, BigNumber.from(101))
        )
        await distributor.setTimeLimitEnabled(token.address, true)
        await time.increase(91 * 86400)
        await distributor.pauseForWithdrawal(token.address)
        await distributor.withdrawUnclaimedTokens(token.address, tree.getHexRoot())
        expect((await distributor.distributions(token.address))[2]).to.eq(false)
        expect(await token.balanceOf(distributor.address)).to.eq(BigNumber.from(0))
      })
    })

    describe('multiple distributions', () => {
      let distributor: MerkleDistributor
      let tree: BalanceTree
      let token2: ERC677
      let token3: ERC677
      beforeEach('deploy', async () => {
        token2 = (await deploy('ERC677', ['Token', 'TKN', 1000000])) as ERC677
        token3 = (await deploy('ERC677', ['Token', 'TKN', 1000000])) as ERC677
        tree = new BalanceTree([
          { account: wallet0, amount: BigNumber.from(100) },
          { account: wallet1, amount: BigNumber.from(101) },
        ])
        distributor = (await deploy('MerkleDistributor')) as MerkleDistributor
        await token.approve(distributor.address, ethers.constants.MaxUint256)
        await token2.approve(distributor.address, ethers.constants.MaxUint256)
        await token3.approve(distributor.address, ethers.constants.MaxUint256)
        const proof0 = tree.getProof(0, wallet0, BigNumber.from(100))
        await expect(
          distributor.claimDistribution(wallet1, 0, wallet0, 101, proof0)
        ).to.be.revertedWith('MerkleDistributor: Distribution does not exist.')
        await distributor.addDistributions(
          [token.address, token2.address, token3.address],
          [tree.getHexRoot(), tree.getHexRoot(), tree.getHexRoot()],
          [BigNumber.from(201), BigNumber.from(201), BigNumber.from(201)]
        )
      })

      it('successful claim', async () => {
        const proof0 = tree.getProof(0, wallet0, BigNumber.from(100))
        await expect(distributor.claimDistribution(token.address, 0, wallet0, 100, proof0))
          .to.emit(distributor, 'Claimed')
          .withArgs(token.address, 0, wallet0, 100)
        await expect(distributor.claimDistribution(token2.address, 0, wallet0, 100, proof0))
          .to.emit(distributor, 'Claimed')
          .withArgs(token2.address, 0, wallet0, 100)
        const proof1 = tree.getProof(1, wallet1, BigNumber.from(101))
        await expect(distributor.claimDistribution(token.address, 1, wallet1, 101, proof1))
          .to.emit(distributor, 'Claimed')
          .withArgs(token.address, 1, wallet1, 101)
        await expect(distributor.claimDistribution(token3.address, 1, wallet1, 101, proof1))
          .to.emit(distributor, 'Claimed')
          .withArgs(token3.address, 1, wallet1, 101)
      })

      it('transfers the token', async () => {
        const proof0 = tree.getProof(0, wallet0, BigNumber.from(100))
        expect(await token.balanceOf(wallet0)).to.eq(0)
        await distributor.claimDistribution(token.address, 0, wallet0, 100, proof0)
        expect(await token.balanceOf(wallet0)).to.eq(100)
        await distributor.claimDistribution(token2.address, 0, wallet0, 100, proof0)
        expect(await token2.balanceOf(wallet0)).to.eq(100)
        await distributor.claimDistribution(token3.address, 0, wallet0, 100, proof0)
        expect(await token3.balanceOf(wallet0)).to.eq(100)
      })

      it('increments claimed amount', async () => {
        const proof0 = tree.getProof(0, wallet0, BigNumber.from(100))
        expect(await distributor.getClaimed(token.address, wallet0)).to.eq(0)
        expect(await distributor.getClaimed(token.address, wallet1)).to.eq(0)
        await distributor.claimDistribution(token.address, 0, wallet0, 100, proof0)
        expect(await distributor.getClaimed(token.address, wallet0)).to.eq(100)
        expect(await distributor.getClaimed(token.address, wallet1)).to.eq(0)

        expect(await distributor.getClaimed(token2.address, wallet0)).to.eq(0)
        expect(await distributor.getClaimed(token2.address, wallet1)).to.eq(0)
        await distributor.claimDistribution(token2.address, 0, wallet0, 100, proof0)
        expect(await distributor.getClaimed(token2.address, wallet0)).to.eq(100)
        expect(await distributor.getClaimed(token2.address, wallet1)).to.eq(0)
      })

      it('cannot allow two claims', async () => {
        const proof0 = tree.getProof(0, wallet0, BigNumber.from(100))
        await distributor.claimDistribution(token.address, 0, wallet0, 100, proof0)
        await expect(
          distributor.claimDistribution(token.address, 0, wallet0, 100, proof0)
        ).to.be.revertedWith('MerkleDistributor: No claimable tokens.')

        await distributor.claimDistribution(token2.address, 0, wallet0, 100, proof0)
        await expect(
          distributor.claimDistribution(token2.address, 0, wallet0, 100, proof0)
        ).to.be.revertedWith('MerkleDistributor: No claimable tokens.')
      })

      it('cannot add distributions of unequal length', async () => {
        await expect(
          distributor.addDistributions(
            [token.address, token2.address, token2.address],
            [tree.getHexRoot(), tree.getHexRoot()],
            [BigNumber.from(201), BigNumber.from(201)]
          )
        ).to.be.revertedWith('MerkleDistributor: Array lengths need to match.')
      })

      it('can update distributions', async () => {
        const newTree = new BalanceTree([
          { account: wallet0, amount: BigNumber.from(200) },
          { account: wallet1, amount: BigNumber.from(201) },
        ])
        let proof0 = tree.getProof(0, wallet0, BigNumber.from(100))

        await distributor.claimDistribution(token.address, 0, wallet0, 100, proof0)
        await distributor.updateDistributions(
          [token.address, token3.address],
          [newTree.getHexRoot(), newTree.getHexRoot()],
          [BigNumber.from(200), BigNumber.from(200)]
        )

        let ts = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp
        expect((await distributor.distributions(token.address))[3]).to.eq(ts)

        proof0 = newTree.getProof(0, wallet0, BigNumber.from(200))
        let proof1 = newTree.getProof(1, wallet1, BigNumber.from(201))

        await distributor.claimDistribution(token.address, 0, wallet0, 200, proof0)
        await distributor.claimDistribution(token.address, 1, wallet1, 201, proof1)
        await distributor.claimDistribution(token3.address, 0, wallet0, 200, proof0)
        await distributor.claimDistribution(token3.address, 1, wallet1, 201, proof1)
        expect(await distributor.getClaimed(token.address, wallet0)).to.eq(200)
        expect(await distributor.getClaimed(token.address, wallet1)).to.eq(201)
        expect(await distributor.getClaimed(token3.address, wallet0)).to.eq(200)
        expect(await distributor.getClaimed(token3.address, wallet1)).to.eq(201)
        expect(await token.balanceOf(wallet0)).to.eq(200)
        expect(await token.balanceOf(wallet1)).to.eq(201)
        expect(await token3.balanceOf(wallet0)).to.eq(200)
        expect(await token3.balanceOf(wallet1)).to.eq(201)
      })

      it('cannot update distributions of unequal length', async () => {
        await expect(
          distributor.updateDistributions(
            [token.address, token2.address, token2.address],
            [tree.getHexRoot(), tree.getHexRoot()],
            [BigNumber.from(201), BigNumber.from(201)]
          )
        ).to.be.revertedWith('MerkleDistributor: Array lengths need to match.')
      })

      it('cannot update distribution that does not exist', async () => {
        await expect(
          distributor.updateDistributions(
            [token.address, wallet1],
            [tree.getHexRoot(), tree.getHexRoot()],
            [BigNumber.from(201), BigNumber.from(201)]
          )
        ).to.be.revertedWith('MerkleDistributor: Distribution does not exist.')
      })

      it('can claim multiple distributions', async () => {
        const proof0 = tree.getProof(0, wallet0, BigNumber.from(100))

        await distributor.claimDistributions(
          [token.address, token3.address],
          [0, 0],
          wallet0,
          [100, 100],
          [proof0, proof0]
        )
        expect(await distributor.getClaimed(token.address, wallet0)).to.eq(100)
        expect(await distributor.getClaimed(token3.address, wallet0)).to.eq(100)
      })
    })
  })
})
