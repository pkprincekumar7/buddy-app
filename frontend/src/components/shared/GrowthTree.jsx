import { motion } from 'framer-motion';

export default function GrowthTree({ pillarScores = {}, size = 'md' }) {
  const avgScore = Object.values(pillarScores).reduce((a, b) => a + (b || 0), 0) / 6;
  const treeHeight = Math.max(20, Math.min(100, avgScore));
  
  const sizeClasses = {
    sm: 'w-24 h-32',
    md: 'w-40 h-56',
    lg: 'w-56 h-72'
  };
  
  return (
    <div className={`${sizeClasses[size]} relative flex items-end justify-center`}>
      {/* Ground */}
      <div className="absolute bottom-0 w-full h-4 bg-gradient-to-t from-amber-200 to-amber-100 rounded-full opacity-60" />
      
      {/* Trunk */}
      <motion.div 
        className="absolute bottom-2 w-4 bg-gradient-to-t from-amber-700 to-amber-500 rounded-t-lg"
        initial={{ height: 0 }}
        animate={{ height: `${treeHeight * 0.4}%` }}
        transition={{ duration: 1, ease: "easeOut" }}
      />
      
      {/* Foliage layers */}
      <motion.div
        className="absolute bottom-[35%] w-20 h-20 bg-gradient-to-br from-emerald-400 to-emerald-600 rounded-full opacity-90"
        initial={{ scale: 0 }}
        animate={{ scale: treeHeight > 30 ? 1 : 0 }}
        transition={{ duration: 0.5, delay: 0.5 }}
      />
      <motion.div
        className="absolute bottom-[50%] w-16 h-16 bg-gradient-to-br from-emerald-300 to-emerald-500 rounded-full opacity-90"
        initial={{ scale: 0 }}
        animate={{ scale: treeHeight > 50 ? 1 : 0 }}
        transition={{ duration: 0.5, delay: 0.7 }}
      />
      <motion.div
        className="absolute bottom-[62%] w-12 h-12 bg-gradient-to-br from-emerald-200 to-emerald-400 rounded-full opacity-90"
        initial={{ scale: 0 }}
        animate={{ scale: treeHeight > 70 ? 1 : 0 }}
        transition={{ duration: 0.5, delay: 0.9 }}
      />
      
      {/* Sparkles for high scores */}
      {avgScore > 60 && (
        <>
          <motion.div
            className="absolute top-4 right-6 w-2 h-2 bg-yellow-400 rounded-full"
            animate={{ opacity: [0.5, 1, 0.5], scale: [1, 1.2, 1] }}
            transition={{ duration: 2, repeat: Infinity }}
          />
          <motion.div
            className="absolute top-12 left-8 w-1.5 h-1.5 bg-yellow-300 rounded-full"
            animate={{ opacity: [0.3, 1, 0.3], scale: [1, 1.3, 1] }}
            transition={{ duration: 1.5, repeat: Infinity, delay: 0.5 }}
          />
        </>
      )}
    </div>
  );
}