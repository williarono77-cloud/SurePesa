import { useState, useEffect, useRef } from 'react'

/**
 * Maps multiplier value to normalized progress (0-1) for curve positioning.
 * Uses exponential mapping: higher multipliers map to higher progress values.
 * @param {number} mult - Multiplier value (1.0+)
 * @param {number} maxMult - Maximum expected multiplier (~10x)
 * @returns {number} Progress value 0-1
 */
function multiplierToProgress(mult, maxMult = 10) {
  if (mult <= 1.0) return 0
  // Exponential mapping: 1x -> 0, maxMult -> ~0.95
  // Formula: progress = 1 - e^(-k * (mult - 1) / (maxMult - 1))
  const k = 2.5
  const normalized = (mult - 1) / (maxMult - 1)
  return 1 - Math.exp(-k * normalized)
}

/**
 * Local round engine for simulating rounds when Supabase data is not available.
 * Returns multiplier, state, progress (0-1), and flewAway status.
 * Progress is tied to multiplier value for accurate curve positioning.
 */
export function useRoundEngine(externalMultiplier = null, externalState = null) {
  const [multiplier, setMultiplier] = useState(1.0)
  const [state, setState] = useState('live') // 'live' | 'ended'
  const [flewAway, setFlewAway] = useState(false)
  const [progress, setProgress] = useState(0) // 0-1 for plane positioning
  const [phase, setPhase] = useState('moving') // 'moving' | 'paused' | 'scaling' | 'exiting'
  const [scaleProgress, setScaleProgress] = useState(0) // 0-1 for scaling animation
  const animationRef = useRef(null)
  const crashPointRef = useRef(null)
  const startTimeRef = useRef(null)
  const roundDurationRef = useRef(null)
  const exitProgressRef = useRef(0) // For flew away exit animation
  const lastMultiplierRef = useRef(1.0)
  const phaseStartTimeRef = useRef(null)

  useEffect(() => {
    // If external data is provided, use it
    if (externalMultiplier !== null && externalState !== null) {
      const numMultiplier = Number(externalMultiplier) || 1.0
      const isLive = externalState === 'live' || externalState === 'active'
      
      // Smooth transition for multiplier updates
      const targetMultiplier = numMultiplier
      const currentMultiplier = lastMultiplierRef.current
      
      // If multiplier increased significantly, update immediately
      // Otherwise, smooth interpolation for real-time updates
      if (targetMultiplier > currentMultiplier * 1.1) {
        setMultiplier(targetMultiplier)
        lastMultiplierRef.current = targetMultiplier
      } else {
        // Smooth interpolation (lerp) for minor updates
        const lerpFactor = 0.15
        const smoothed = currentMultiplier + (targetMultiplier - currentMultiplier) * lerpFactor
        setMultiplier(smoothed)
        lastMultiplierRef.current = smoothed
      }
      
      setState(isLive ? 'live' : 'ended')
      setFlewAway(!isLive)
      
      // For external data, use simpler progress calculation
      // Calculate progress from multiplier value
      const baseProgress = multiplierToProgress(numMultiplier)
      if (isLive) {
        setProgress(Math.min(baseProgress, 0.9)) // Cap at 90% for external data
        setPhase('moving')
        setScaleProgress(0)
      } else {
        // On ended, trigger exit sequence
        setProgress(0.9)
        setPhase('exiting')
        setScaleProgress(1) // Already scaled
      }
      return
    }

    // Local simulation
    function animate() {
      if (!startTimeRef.current) {
        startTimeRef.current = Date.now()
        phaseStartTimeRef.current = Date.now()
        // Random crash point between 1.5x and 10x, random duration 5-20 seconds
        crashPointRef.current = 1.5 + Math.random() * 8.5
        roundDurationRef.current = 5000 + Math.random() * 15000
        exitProgressRef.current = 0
        lastMultiplierRef.current = 1.0
        setPhase('moving')
        setScaleProgress(0)
        setProgress(0)
        setMultiplier(1.0)
      }

      const elapsed = Date.now() - startTimeRef.current
      const phaseElapsed = Date.now() - phaseStartTimeRef.current

      if (phase === 'moving') {
        // Phase 1: Move from (0,0) to 90% on both axes
        const targetProgress = 0.9
        const moveDuration = roundDurationRef.current * 0.8 // Use 80% of round duration for movement
        const moveProgress = Math.min(elapsed / moveDuration, 1)
        
        if (moveProgress >= 1) {
          // Reached 90%, move to pause phase
          setProgress(targetProgress)
          // Calculate multiplier that gives Y = 90% (0.9 normalized)
          // multiplierToY(mult) = 1 - e^(-2.5 * (mult - 1) / 9)
          // To get 0.9: 0.9 = 1 - e^(-2.5 * (mult - 1) / 9)
          // e^(-2.5 * (mult - 1) / 9) = 0.1
          // -2.5 * (mult - 1) / 9 = ln(0.1)
          // mult - 1 = -9 * ln(0.1) / 2.5
          // mult = 1 + 9 * ln(0.1) / 2.5 ≈ 1 + 9 * (-2.3026) / 2.5 ≈ 1 + 8.29 ≈ 9.29
          // But we want to use the crash point, so we'll calculate what multiplier gives us 0.9 Y
          const targetYNormalized = 0.9
          const k = 2.5
          const maxMult = 10
          // Solve: targetYNormalized = 1 - e^(-k * (mult - 1) / (maxMult - 1))
          const multAt90 = 1 + (maxMult - 1) * (-Math.log(1 - targetYNormalized) / k)
          setMultiplier(multAt90)
          lastMultiplierRef.current = multAt90
          setPhase('paused')
          phaseStartTimeRef.current = Date.now()
        } else {
          // Moving to 90% - interpolate both progress and multiplier
          const currentProgress = moveProgress * targetProgress
          setProgress(currentProgress)
          // Calculate multiplier that gives corresponding Y position
          const targetYNormalized = currentProgress // Y progress matches X progress
          const k = 2.5
          const maxMult = 10
          const currentMultiplier = 1 + (maxMult - 1) * (-Math.log(1 - targetYNormalized) / k)
          setMultiplier(currentMultiplier)
          lastMultiplierRef.current = currentMultiplier
        }
      } else if (phase === 'paused') {
        // Phase 2: Pause for 1 second
        if (phaseElapsed >= 1000) {
          setPhase('scaling')
          phaseStartTimeRef.current = Date.now()
        }
      } else if (phase === 'scaling') {
        // Phase 3: Scale down graph (1 second duration)
        const scaleDuration = 1000
        const scaleProgressValue = Math.min(phaseElapsed / scaleDuration, 1)
        setScaleProgress(scaleProgressValue)
        
        if (scaleProgressValue >= 1) {
          setPhase('exiting')
          phaseStartTimeRef.current = Date.now()
          setFlewAway(true)
          setState('ended')
        }
      } else if (phase === 'exiting') {
        // Phase 4: Plane exits to the right
        const exitDuration = 1500
        const exitProgressValue = Math.min(phaseElapsed / exitDuration, 1)
        exitProgressRef.current = exitProgressValue
        
        // Plane moves horizontally to the right
        setProgress(0.9 + exitProgressValue * 0.5) // Move beyond graph
        
        if (exitProgressValue >= 1) {
          // Phase 5: Reset for next round
          setTimeout(() => {
            startTimeRef.current = null
            crashPointRef.current = null
            exitProgressRef.current = 0
            setMultiplier(1.0)
            setState('live')
            setFlewAway(false)
            setProgress(0)
            setPhase('moving')
            setScaleProgress(0)
            lastMultiplierRef.current = 1.0
            phaseStartTimeRef.current = null
          }, 500)
        }
      }

      animationRef.current = requestAnimationFrame(animate)
    }

    animationRef.current = requestAnimationFrame(animate)

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
        animationRef.current = null
      }
    }
  }, [externalMultiplier, externalState, flewAway, phase])

  return { multiplier, state, flewAway, progress, phase, scaleProgress }
}
